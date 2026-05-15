package com.movie.ticket.upstream;

import com.aliyun.oss.ClientException;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.OSSException;
import com.aliyun.oss.model.ObjectMetadata;
import com.aliyun.oss.model.PutObjectResult;
import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.exception.BusinessException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
@ConditionalOnProperty(prefix = "ticket.upstream", name = "mock-enabled", havingValue = "false")
public class PiaoDaRenClient implements TicketUpstreamClient {

    private final RestClient restClient;
    private final UpstreamProperties properties;
    private final PiaoDaRenSession session;

    public PiaoDaRenClient(RestClient restClient, UpstreamProperties properties, PiaoDaRenSession session) {
        this.restClient = restClient;
        this.properties = properties;
        this.session = session;
    }

    @Override
    public UploadedImage uploadImage(String imageBase64) {
        byte[] imageBytes = java.util.Base64.getDecoder().decode(stripBase64Prefix(imageBase64));
        String region = defaultText(properties.ossRegion(), "oss-cn-beijing");
        String bucketName = defaultText(properties.ossBucket(), "liangpiao-ticket-img");
        String uploadDir = defaultText(properties.ossUploadDir(), "ticket-img").replaceAll("^/+|/+$", "");
        String objectName = uploadDir + "/" + UUID.randomUUID().toString().replace("-", "") + ".jpg";
        String endpoint = "https://" + region + ".aliyuncs.com";

        OSS ossClient = new OSSClientBuilder().build(
                endpoint,
                requireText(properties.ossAccessKeyId(), "missing oss access key id"),
                requireText(properties.ossAccessKeySecret(), "missing oss access key secret")
        );
        try {
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentType(MediaType.IMAGE_JPEG_VALUE);
            metadata.setContentLength(imageBytes.length);
            PutObjectResult result = ossClient.putObject(bucketName, objectName, new java.io.ByteArrayInputStream(imageBytes), metadata);
            if (!StringUtils.hasText(result.getRequestId())) {
                throw new BusinessException("oss upload failed: missing request id");
            }
        } catch (OSSException | ClientException exception) {
            throw new BusinessException("oss upload failed: " + exception.getMessage());
        } finally {
            ossClient.shutdown();
        }

        String imageUrl = "https://" + bucketName + "." + region + ".aliyuncs.com/" + objectName;
        return new UploadedImage(imageUrl, "/" + objectName);
    }

    @Override
    public MovieTicketInfo recognizeTicket(String imageUrl) {
        String encodedImageUrl = URLEncoder.encode(imageUrl, StandardCharsets.UTF_8);
        Map<?, ?> response = postForm(properties.ocrPath(), "imgUrl=" + encodedImageUrl);
        Map<?, ?> ocrData = extractDataMap(response);
        Map<?, ?> discern = extractDiscernMap(ocrData);
        List<String> seats = extractSeatNames(discern.get("seats"));
        Map<String, String> seatsAndPrice = extractSeatsAndPrice(discern.get("seats"));
        BigDecimal maxPrice = extractMaxSeatPrice(discern.get("seats"));


        return new MovieTicketInfo(
                stringValue(ocrData.get("taskId")),
                stringValue(discern.get("province")),
                stringValue(discern.get("city")),
                stringValue(discern.get("area")),
                stringValue(discern.get("cityCode")),
                stringValue(discern.get("cinemaId")),
                stringValue(discern.get("cinemaCode")),
                stringValue(discern.get("cinemaAddress")),
                stringValue(discern.get("filmId")),
                stringValue(discern.get("filmImg")),
                intValue(discern.get("customFilmType")),
                stringValue(discern.get("showId")),
                stringValue(discern.get("filmName")),
                stringValue(discern.get("cinemaName")),
                parseShowTime(discern.get("showTime")),
                stringValue(discern.get("hallName")),
                stringValue(discern.get("planType")),
                seats.isEmpty() ? null : seats.size(),
                seats,
                seatsAndPrice,
                maxPrice == null ? null : maxPrice.toPlainString(),
                centsToYuanText(discern.get("totalImagePrice")),
                defaultText(stringValue(ocrData.get("imageUrl")), imageUrl)
        );
    }

    @Override
    public UpstreamQuote quote(MovieTicketInfo ticketInfo) {
        if (!StringUtils.hasText(ticketInfo.showId())) {
            throw new BusinessException("missing showId from OCR result");
        }
        List<OfficialQuoteResult> results = List.of(
                requestOfficialQuote(ticketInfo, "LIMIT_PRICE"),
                requestOfficialQuote(ticketInfo, "FIX_PRICE")
        );
        OfficialQuoteResult selected = results.stream()
                .filter(result -> result.price().compareTo(BigDecimal.ZERO) > 0)
                .max(java.util.Comparator.comparing(OfficialQuoteResult::price))
                .orElseThrow(() -> new BusinessException("missing valid price from upstream quotation"));
        return new UpstreamQuote(selected.price(), selected.taskId(), selected.channel(), results.toString());
    }

    @Override
    public UpstreamSubmitOrderResult submitOrder(SubmitOrderCommand command) {
        if (!StringUtils.hasText(command.officialQuotationId())) {
            throw new BusinessException("missing official quotation id");
        }
        if (!StringUtils.hasText(command.showId())) {
            throw new BusinessException("missing show id");
        }
        Map<String, Object> body = new HashMap<>();
        body.put("userId", defaultText(command.userId(), ""));
        body.put("userName", defaultText(command.userName(), ""));
        body.put("showId", command.showId());
        body.put("seats", Optional.ofNullable(command.seats()).orElse(List.of()).stream().map(this::parseSeatName).toList());
        body.put("channel", 3);
        body.put("orderType", 1);
        body.put("changeSeat", 1);
        body.put("inputLimitPrice", toCents(command.upstreamPrice()));
        body.put("matchChannel", 1);
        body.put("quotationMode", 1);
        body.put("inquiryPrice", toCents(command.upstreamPrice()));
        body.put("officialQuotationId", command.officialQuotationId());
        body.put("officialChannel", 1);
        body.put("OfficialQuotationChannel", List.of(officialQuotationChannelCode(command.officialQuotationChannel())));
        body.put("officialChannelState", 1);

        Map<?, ?> response = postJson("/film/order/officialSubmitOrder", body);
        Map<?, ?> data = extractDataMap(response);
        String orderNumber = stringValue(data.get("orderNumber"));
        if (!StringUtils.hasText(orderNumber)) {
            throw new BusinessException("missing upstream order number");
        }
        return new UpstreamSubmitOrderResult(orderNumber, body.toString(), response.toString());
    }

    private OfficialQuoteResult requestOfficialQuote(MovieTicketInfo ticketInfo, String channel) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("showId", ticketInfo.showId());
            body.put("netPrice", toCents(ticketInfo.maxPrice()));
            body.put("seatCount", Optional.ofNullable(ticketInfo.seatCount()).orElse(1));
            body.put("seatName", Optional.ofNullable(ticketInfo.seats()).orElse(List.of()));
            body.put("quotationChannels", List.of(channel));

            Map<?, ?> response = postJson(properties.quotePath(), body);
            Map<?, ?> data = extractDataMap(response);
            BigDecimal price = officialPriceForChannel(data, channel);
            return new OfficialQuoteResult(
                    channel,
                    defaultPrice(price),
                    defaultPrice(centsToYuan(data.get("fixPrice"))),
                    defaultPrice(centsToYuan(data.get("limitPrice"))),
                    defaultPrice(centsToYuan(data.get("commercePrice"))),
                    stringValue(data.get("taskId")),
                    true,
                    response.toString()
            );
        } catch (Exception exception) {
            return new OfficialQuoteResult(
                    channel,
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    null,
                    false,
                    exception.getMessage()
            );
        }
    }

    private BigDecimal officialPriceForChannel(Map<?, ?> data, String channel) {
        return switch (channel) {
            case "LIMIT_PRICE" -> centsToYuan(data.get("limitPrice"));
            case "FIX_PRICE" -> centsToYuan(data.get("fixPrice"));
            case "COMMERCE_PRICE" -> centsToYuan(data.get("commercePrice"));
            default -> BigDecimal.ZERO;
        };
    }

    private Map<String, Object> parseSeatName(String seatName) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("(\\d+)排(\\d+)座").matcher(defaultText(seatName, ""));
        if (matcher.find()) {
            return Map.of(
                    "row", Integer.parseInt(matcher.group(1)),
                    "col", Integer.parseInt(matcher.group(2)),
                    "seatName", seatName
            );
        }
        return Map.of("row", 1, "col", 1, "seatName", defaultText(seatName, ""));
    }

    private int officialQuotationChannelCode(String channel) {
        if ("FIX_PRICE".equals(channel)) {
            return 2;
        }
        return 1;
    }

    private BigDecimal defaultPrice(BigDecimal price) {
        return price == null ? BigDecimal.ZERO : price;
    }

    private Map<?, ?> postJson(String path, Object body) {
        return restClient.post()
                .uri(requireText(properties.baseUrl(), "missing upstream base url") + path)
                .headers(headers -> headers.addAll(defaultHeaders(MediaType.APPLICATION_JSON_VALUE)))
                .body(body)
                .retrieve()
                .body(Map.class);
    }

    private Map<?, ?> postForm(String path, String body) {
        return restClient.post()
                .uri(requireText(properties.baseUrl(), "missing upstream base url") + path)
                .headers(headers -> headers.addAll(defaultHeaders(MediaType.APPLICATION_FORM_URLENCODED_VALUE)))
                .body(body)
                .retrieve()
                .body(Map.class);
    }

    private org.springframework.util.MultiValueMap<String, String> defaultHeaders(String contentType) {
        org.springframework.util.LinkedMultiValueMap<String, String> headers = new org.springframework.util.LinkedMultiValueMap<>();
        headers.add("Accept", "*/*");
        headers.add("Content-Type", contentType);
        headers.add("Origin", "http://h5.liangpiao.net.cn");
        headers.add("Referer", "http://h5.liangpiao.net.cn/");
        headers.add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36");
        headers.add("user-token", session.getUserToken(properties.userToken()));
        return headers;
    }

    private Map<?, ?> extractDataMap(Map<?, ?> response) {
        if (response == null) {
            throw new BusinessException("empty upstream response");
        }
        String state = stringValue(response.get("state"));
        if (!"200".equals(state)) {
            throw new BusinessException("upstream error: " + messageFrom(response));
        }
        Object result = response.get("result");
        if (result != null && !Boolean.parseBoolean(String.valueOf(result))) {
            throw new BusinessException("upstream failed: " + messageFrom(response));
        }
        Object data = response.get("data");
        if (data instanceof Map<?, ?> dataMap) {
            return dataMap;
        }
        throw new BusinessException("upstream response missing data");
    }

    private Map<?, ?> extractDiscernMap(Map<?, ?> data) {
        Object discern = data.get("discern");
        if (discern instanceof Map<?, ?> discernMap) {
            return discernMap;
        }
        throw new BusinessException("OCR response missing discern");
    }

    private List<String> extractSeatNames(Object seatsValue) {
        List<String> seatNames = new ArrayList<>();
        if (seatsValue instanceof List<?> seats) {
            for (Object seat : seats) {
                if (seat instanceof Map<?, ?> seatMap && StringUtils.hasText(stringValue(seatMap.get("seatName")))) {
                    seatNames.add(stringValue(seatMap.get("seatName")));
                }
            }
        }
        return seatNames;
    }

    private Map<String, String> extractSeatsAndPrice(Object seatsValue) {
        Map<String, String> seatsAndPrice = new LinkedHashMap<>();
        if (seatsValue instanceof List<?> seats) {
            for (Object seat : seats) {
                if (seat instanceof Map<?, ?> seatMap) {
                    String seatName = stringValue(seatMap.get("seatName"));
                    BigDecimal seatPrice = centsToYuan(seatMap.get("seatPrice"));
                    if (StringUtils.hasText(seatName) && seatPrice != null) {
                        seatsAndPrice.put(seatName, seatPrice.toPlainString());
                    }
                }
            }
        }
        return seatsAndPrice;
    }

    private BigDecimal extractMaxSeatPrice(Object seatsValue) {
        BigDecimal maxPrice = null;
        if (seatsValue instanceof List<?> seats) {
            for (Object seat : seats) {
                if (seat instanceof Map<?, ?> seatMap) {
                    BigDecimal seatPrice = centsToYuan(seatMap.get("seatPrice"));
                    if (seatPrice != null && (maxPrice == null || seatPrice.compareTo(maxPrice) > 0)) {
                        maxPrice = seatPrice;
                    }
                }
            }
        }
        return maxPrice;
    }

    private LocalDateTime parseShowTime(Object showTimeValue) {
        if (showTimeValue == null) {
            return null;
        }
        try {
            long timestamp = Long.parseLong(String.valueOf(showTimeValue));
            return LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp), ZoneId.systemDefault());
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private String toCents(String yuan) {
        if (!StringUtils.hasText(yuan)) {
            return "0";
        }
        return new BigDecimal(yuan).multiply(new BigDecimal("100")).setScale(0, RoundingMode.HALF_UP).toPlainString();
    }

    private int toCents(BigDecimal yuan) {
        if (yuan == null) {
            return 0;
        }
        return yuan.multiply(new BigDecimal("100")).setScale(0, RoundingMode.HALF_UP).intValue();
    }

    private BigDecimal centsToYuan(Object cents) {
        if (cents == null) {
            return null;
        }
        return new BigDecimal(String.valueOf(cents)).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP);
    }

    private String centsToYuanText(Object cents) {
        BigDecimal yuan = centsToYuan(cents);
        return yuan == null ? null : yuan.toPlainString();
    }

    private String stripBase64Prefix(String imageBase64) {
        int commaIndex = imageBase64.indexOf(',');
        return commaIndex >= 0 ? imageBase64.substring(commaIndex + 1) : imageBase64;
    }

    private String requireText(String value, String message) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(message);
        }
        return value;
    }

    private String defaultText(String value, String fallback) {
        return StringUtils.hasText(value) ? value : fallback;
    }

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Integer intValue(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return Integer.valueOf(String.valueOf(value));
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private String messageFrom(Map<?, ?> response) {
        Object message = response.get("message");
        return message == null ? response.toString() : String.valueOf(message);
    }

    private record OfficialQuoteResult(
            String channel,
            BigDecimal price,
            BigDecimal fixPrice,
            BigDecimal limitPrice,
            BigDecimal commercePrice,
            String taskId,
            boolean upstreamOk,
            String raw
    ) {
    }
}
