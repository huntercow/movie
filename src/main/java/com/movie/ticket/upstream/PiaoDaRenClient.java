package com.movie.ticket.upstream;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.aliyun.oss.ClientException;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.OSSException;
import com.aliyun.oss.model.ObjectMetadata;
import com.aliyun.oss.model.PutObjectResult;
import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.exception.BusinessException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
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
import java.util.UUID;

@Component
@ConditionalOnProperty(prefix = "ticket.upstream", name = "mock-enabled", havingValue = "false")
@ConditionalOnExpression("'${ticket.upstream.provider:piaodaren}' == 'piaodaren'")
public class PiaoDaRenClient implements TicketUpstreamClient {

    private final RestClient restClient;
    private final UpstreamProperties properties;
    private final PiaoDaRenSession session;
    private final ObjectMapper objectMapper;

    public PiaoDaRenClient(RestClient restClient, UpstreamProperties properties, PiaoDaRenSession session, ObjectMapper objectMapper) {
        this.restClient = restClient;
        this.properties = properties;
        this.session = session;
        this.objectMapper = objectMapper;
    }

    @Override
    public UploadedImage uploadImage(String imageBase64) {
        DecodedImage image = decodeImage(imageBase64);
        String region = requireText(properties.ossRegion(), "missing oss region");
        String bucketName = requireText(properties.ossBucket(), "missing oss bucket");
        String uploadDir = requireText(properties.ossUploadDir(), "missing oss upload directory")
                .replaceAll("^/+|/+$", "");
        String objectName = uploadDir + "/" + UUID.randomUUID().toString().replace("-", "") + image.extension();
        String endpoint = "https://" + region + ".aliyuncs.com";

        OSS ossClient = new OSSClientBuilder().build(
                endpoint,
                requireText(properties.ossAccessKeyId(), "missing oss access key id"),
                requireText(properties.ossAccessKeySecret(), "missing oss access key secret")
        );
        try {
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentType(image.contentType());
            metadata.setContentLength(image.bytes().length);
            PutObjectResult result = ossClient.putObject(
                    bucketName,
                    objectName,
                    new java.io.ByteArrayInputStream(image.bytes()),
                    metadata
            );
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


        MovieTicketInfo ticketInfo = new MovieTicketInfo(
                optionalString(ocrData, "taskId", "OCR data"),
                optionalString(discern, "province", "OCR discern"),
                optionalString(discern, "city", "OCR discern"),
                optionalString(discern, "area", "OCR discern"),
                optionalString(discern, "cityCode", "OCR discern"),
                optionalString(discern, "cinemaId", "OCR discern"),
                optionalString(discern, "cinemaCode", "OCR discern"),
                optionalString(discern, "cinemaAddress", "OCR discern"),
                optionalString(discern, "filmId", "OCR discern"),
                optionalString(discern, "filmImg", "OCR discern"),
                optionalInteger(discern, "customFilmType", "OCR discern"),
                requiredString(discern, "showId", "OCR discern"),
                optionalString(discern, "filmName", "OCR discern"),
                optionalString(discern, "cinemaName", "OCR discern"),
                parseShowTime(discern.get("showTime")),
                optionalString(discern, "hallName", "OCR discern"),
                optionalString(discern, "planType", "OCR discern"),
                seats.size(),
                seats,
                seatsAndPrice,
                maxPrice == null ? null : maxPrice.toPlainString(),
                centsToYuanText(discern.get("totalImagePrice")),
                requiredString(ocrData, "imageUrl", "OCR data")
        );
        validateRecognizedTicket(ticketInfo);
        return ticketInfo;
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
                .orElseThrow(() -> new BusinessException("upstream quotation returned no positive price"));
        return new UpstreamQuote(selected.price(), selected.taskId(), selected.channel(), toJson(results));
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
        body.put("userId", requireText(command.userId(), "missing upstream user id"));
        body.put("userName", requireText(command.userName(), "missing upstream user name"));
        body.put("showId", command.showId());
        if (command.seats() == null || command.seats().isEmpty()) {
            throw new BusinessException("missing seats for upstream order");
        }
        body.put("seats", command.seats().stream().map(this::parseSeatName).toList());
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
        String orderNumber = requiredString(data, "orderNumber", "upstream submit data");
        return new UpstreamSubmitOrderResult(null, orderNumber, toJson(body), toJson(response));
    }

    @Override
    public UpstreamPayOrderResult payOrder(String orderNumber) {
        if (!StringUtils.hasText(orderNumber)) {
            throw new BusinessException("missing upstream order number");
        }
        String body = "orderNumber=" + URLEncoder.encode(orderNumber, StandardCharsets.UTF_8);
        Map<?, ?> response = postForm("/film/order/payOrder", body);
        validateSuccessResponse(response);
        return new UpstreamPayOrderResult(orderNumber, body, toJson(response));
    }

    @Override
    public UpstreamCancelOrderResult cancelOrder(String orderId) {
        if (!StringUtils.hasText(orderId)) {
            throw new BusinessException("missing upstream order id");
        }
        String body = "orderId=" + URLEncoder.encode(orderId, StandardCharsets.UTF_8);
        Map<?, ?> response = postForm("/film/order/cancelOrder", body);
        validateSuccessResponse(response);
        return new UpstreamCancelOrderResult(orderId, body, toJson(response));
    }

    @Override
    public UpstreamOrderDetailResult getOrderDetail(String orderNumber) {
        if (!StringUtils.hasText(orderNumber)) {
            throw new BusinessException("missing upstream order number");
        }
        Map<?, ?> response = restClient.get()
                .uri(requireText(properties.baseUrl(), "missing upstream base url")
                        + "/film/order/getOrderDetail?orderNumber="
                        + URLEncoder.encode(orderNumber, StandardCharsets.UTF_8))
                .headers(headers -> headers.addAll(defaultHeaders(MediaType.APPLICATION_FORM_URLENCODED_VALUE)))
                .retrieve()
                .onStatus(status -> status.isError(), (request, upstreamResponse) ->
                        handleHttpError(upstreamResponse.getStatusCode().value()))
                .body(Map.class);
        Map<?, ?> data = extractDataMap(response);
        Map<?, ?> orderInfo = extractOrderInfoMap(data);
        String orderId = requiredString(orderInfo, "id", "upstream orderInfo");
        return new UpstreamOrderDetailResult(
                orderId,
                orderNumber,
                requiredInteger(orderInfo, "orderStatus", "upstream orderInfo"),
                buildTicketCodeInfo(data.get("ticketInfo")),
                firstText(
                        data.get("failedReason"),
                        data.get("refundReason"),
                        data.get("cancelReason")
                ),
                toJson(response)
        );
    }

    private OfficialQuoteResult requestOfficialQuote(MovieTicketInfo ticketInfo, String channel) {
        if (ticketInfo.seatCount() == null || ticketInfo.seatCount() <= 0) {
            throw new BusinessException("invalid seat count for upstream quotation");
        }
        if (ticketInfo.seats() == null || ticketInfo.seats().isEmpty()) {
            throw new BusinessException("missing seats for upstream quotation");
        }
        Map<String, Object> body = new HashMap<>();
        body.put("showId", ticketInfo.showId());
        body.put("netPrice", toCents(ticketInfo.maxPrice()));
        body.put("seatCount", ticketInfo.seatCount());
        body.put("seatName", ticketInfo.seats());
        body.put("quotationChannels", List.of(channel));

        Map<?, ?> response = postJson(properties.quotePath(), body);
        Map<?, ?> data = extractDataMap(response);
        BigDecimal price = officialPriceForChannel(data, channel);
        return new OfficialQuoteResult(
                channel,
                price,
                requiredString(data, "taskId", "upstream quotation data"),
                toJson(response)
        );
    }

    private BigDecimal officialPriceForChannel(Map<?, ?> data, String channel) {
        return switch (channel) {
            case "LIMIT_PRICE" -> requiredCentsToYuan(data.get("limitPrice"), "quotation limitPrice");
            case "FIX_PRICE" -> requiredCentsToYuan(data.get("fixPrice"), "quotation fixPrice");
            case "COMMERCE_PRICE" -> requiredCentsToYuan(data.get("commercePrice"), "quotation commercePrice");
            default -> throw new BusinessException("unsupported quotation channel: " + channel);
        };
    }

    private Map<String, Object> parseSeatName(String seatName) {
        String requiredSeatName = requireText(seatName, "seat name is required");
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("^(\\d+)排(\\d+)座$").matcher(requiredSeatName);
        if (!matcher.matches()) {
            throw new BusinessException("unsupported seat name format: " + requiredSeatName);
        }
        return Map.of(
                "row", Integer.parseInt(matcher.group(1)),
                "col", Integer.parseInt(matcher.group(2)),
                "seatName", requiredSeatName
        );
    }

    private int officialQuotationChannelCode(String channel) {
        if ("FIX_PRICE".equals(channel)) {
            return 2;
        }
        if ("LIMIT_PRICE".equals(channel)) {
            return 1;
        }
        throw new BusinessException("unsupported official quotation channel: " + channel);
    }

    private Map<?, ?> postJson(String path, Object body) {
        return restClient.post()
                .uri(requireText(properties.baseUrl(), "missing upstream base url") + path)
                .headers(headers -> headers.addAll(defaultHeaders(MediaType.APPLICATION_JSON_VALUE)))
                .body(body)
                .retrieve()
                .onStatus(status -> status.isError(), (request, upstreamResponse) ->
                        handleHttpError(upstreamResponse.getStatusCode().value()))
                .body(Map.class);
    }

    private Map<?, ?> postForm(String path, String body) {
        return restClient.post()
                .uri(requireText(properties.baseUrl(), "missing upstream base url") + path)
                .headers(headers -> headers.addAll(defaultHeaders(MediaType.APPLICATION_FORM_URLENCODED_VALUE)))
                .body(body)
                .retrieve()
                .onStatus(status -> status.isError(), (request, upstreamResponse) ->
                        handleHttpError(upstreamResponse.getStatusCode().value()))
                .body(Map.class);
    }

    private org.springframework.util.MultiValueMap<String, String> defaultHeaders(String contentType) {
        org.springframework.util.LinkedMultiValueMap<String, String> headers = new org.springframework.util.LinkedMultiValueMap<>();
        headers.add("Accept", "*/*");
        headers.add("Content-Type", contentType);
        headers.add("Origin", "http://h5.liangpiao.net.cn");
        headers.add("Referer", "http://h5.liangpiao.net.cn/");
        headers.add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36");
        headers.add("user-token", requireText(
                resolveUserToken(),
                "upstream login required"
        ));
        return headers;
    }

    private String resolveUserToken() {
        String sessionToken = session.getUserToken();
        if (StringUtils.hasText(sessionToken)) {
            return sessionToken;
        }
        if (com.movie.ticket.security.UserScopeContext.get() == null
                && StringUtils.hasText(properties.userToken())) {
            return properties.userToken();
        }
        return null;
    }

    private void handleHttpError(int status) {
        if (status == 401) {
            session.clear();
            throw new BusinessException("upstream authentication expired; login again");
        }
        throw new BusinessException("upstream HTTP request failed with status " + status);
    }

    private Map<?, ?> extractDataMap(Map<?, ?> response) {
        validateSuccessResponse(response);
        Object data = response.get("data");
        if (data instanceof Map<?, ?> dataMap) {
            return dataMap;
        }
        throw new BusinessException("upstream response data must be a JSON object");
    }

    private void validateSuccessResponse(Map<?, ?> response) {
        if (response == null) {
            throw new BusinessException("empty upstream response");
        }
        int state = requiredState(response);
        if (state != 200) {
            throw new BusinessException("upstream returned state " + state + ": " + requiredErrorMessage(response));
        }
    }

    private int requiredState(Map<?, ?> response) {
        Object value = response.get("state");
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value instanceof String text && text.matches("\\d{3}")) {
            return Integer.parseInt(text);
        }
        throw new BusinessException("upstream response state must be a three-digit number");
    }

    private String requiredErrorMessage(Map<?, ?> response) {
        Object value = response.get("message");
        if (value instanceof String message && StringUtils.hasText(message)) {
            return message;
        }
        throw new BusinessException("upstream error response is missing message");
    }

    private Map<?, ?> extractDiscernMap(Map<?, ?> data) {
        Object discern = data.get("discern");
        if (discern instanceof Map<?, ?> discernMap) {
            return discernMap;
        }
        throw new BusinessException("OCR response missing discern");
    }

    private Map<?, ?> extractOrderInfoMap(Map<?, ?> data) {
        Object orderInfo = data.get("orderInfo");
        if (orderInfo instanceof Map<?, ?> orderInfoMap) {
            return orderInfoMap;
        }
        throw new BusinessException("order detail response missing orderInfo");
    }

    private String buildTicketCodeInfo(Object ticketInfoValue) {
        if (ticketInfoValue == null) {
            return null;
        }
        if (!(ticketInfoValue instanceof List<?> ticketInfo)) {
            throw new BusinessException("upstream ticketInfo must be a JSON array");
        }
        List<Map<String, String>> ticketItems = new ArrayList<>();
        for (Object item : ticketInfo) {
            if (!(item instanceof Map<?, ?> itemMap)) {
                throw new BusinessException("upstream ticketInfo item must be a JSON object");
            }
            String ticket = optionalString(itemMap, "ticket", "upstream ticketInfo item");
            String ticketCode = optionalString(itemMap, "ticketCode", "upstream ticketInfo item");
            if (!StringUtils.hasText(ticket) && !StringUtils.hasText(ticketCode)) {
                throw new BusinessException("upstream ticketInfo item must contain ticket or ticketCode");
            }
            Map<String, String> ticketItem = new LinkedHashMap<>();
            ticketItem.put("ticket", ticket);
            ticketItem.put("ticketCode", ticketCode);
            ticketItems.add(ticketItem);
        }
        return toJson(Map.of("ticketItems", ticketItems));
    }

    private List<String> extractSeatNames(Object seatsValue) {
        if (!(seatsValue instanceof List<?> seats) || seats.isEmpty()) {
            throw new BusinessException("OCR discern seats must be a non-empty JSON array");
        }
        List<String> seatNames = new ArrayList<>();
        for (Object seat : seats) {
            if (!(seat instanceof Map<?, ?> seatMap)) {
                throw new BusinessException("OCR seat must be a JSON object");
            }
            seatNames.add(requiredString(seatMap, "seatName", "OCR seat"));
        }
        return seatNames;
    }

    private Map<String, String> extractSeatsAndPrice(Object seatsValue) {
        if (!(seatsValue instanceof List<?> seats) || seats.isEmpty()) {
            throw new BusinessException("OCR discern seats must be a non-empty JSON array");
        }
        Map<String, String> seatsAndPrice = new LinkedHashMap<>();
        for (Object seat : seats) {
            if (!(seat instanceof Map<?, ?> seatMap)) {
                throw new BusinessException("OCR seat must be a JSON object");
            }
            String seatName = requiredString(seatMap, "seatName", "OCR seat");
            BigDecimal seatPrice = requiredCentsToYuan(seatMap.get("seatPrice"), "OCR seatPrice");
            seatsAndPrice.put(seatName, seatPrice.toPlainString());
        }
        return seatsAndPrice;
    }

    private BigDecimal extractMaxSeatPrice(Object seatsValue) {
        if (!(seatsValue instanceof List<?> seats) || seats.isEmpty()) {
            throw new BusinessException("OCR discern seats must be a non-empty JSON array");
        }
        BigDecimal maxPrice = null;
        for (Object seat : seats) {
            if (!(seat instanceof Map<?, ?> seatMap)) {
                throw new BusinessException("OCR seat must be a JSON object");
            }
            BigDecimal seatPrice = requiredCentsToYuan(seatMap.get("seatPrice"), "OCR seatPrice");
            if (maxPrice == null || seatPrice.compareTo(maxPrice) > 0) {
                maxPrice = seatPrice;
            }
        }
        return maxPrice;
    }

    private LocalDateTime parseShowTime(Object showTimeValue) {
        if (!(showTimeValue instanceof Number timestamp)) {
            throw new BusinessException("OCR showTime must be a numeric timestamp");
        }
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(timestamp.longValue()), ZoneId.systemDefault());
    }

    private String toCents(String yuan) {
        if (!StringUtils.hasText(yuan)) {
            throw new BusinessException("yuan amount is required");
        }
        try {
            return new BigDecimal(yuan).multiply(new BigDecimal("100")).setScale(0, RoundingMode.HALF_UP).toPlainString();
        } catch (NumberFormatException exception) {
            throw new BusinessException("yuan amount is invalid", exception);
        }
    }

    private int toCents(BigDecimal yuan) {
        if (yuan == null) {
            throw new BusinessException("yuan amount is required");
        }
        return yuan.multiply(new BigDecimal("100")).setScale(0, RoundingMode.HALF_UP).intValue();
    }

    private BigDecimal centsToYuan(Object cents) {
        if (cents == null) {
            return null;
        }
        return requiredCentsToYuan(cents, "upstream amount");
    }

    private BigDecimal requiredCentsToYuan(Object cents, String field) {
        if (!(cents instanceof Number number)) {
            throw new BusinessException(field + " must be numeric cents");
        }
        return new BigDecimal(number.toString()).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP);
    }

    private String centsToYuanText(Object cents) {
        BigDecimal yuan = centsToYuan(cents);
        return yuan == null ? null : yuan.toPlainString();
    }

    private DecodedImage decodeImage(String imageBase64) {
        if (!StringUtils.hasText(imageBase64)) {
            throw new BusinessException("ticket image is empty");
        }
        String contentType = MediaType.IMAGE_JPEG_VALUE;
        String extension = ".jpg";
        String encoded = imageBase64;
        if (imageBase64.startsWith("data:")) {
            int commaIndex = imageBase64.indexOf(',');
            if (commaIndex < 0 || !imageBase64.substring(0, commaIndex).endsWith(";base64")) {
                throw new BusinessException("ticket image data URL must use base64 encoding");
            }
            contentType = imageBase64.substring("data:".length(), imageBase64.indexOf(';'));
            extension = switch (contentType) {
                case MediaType.IMAGE_JPEG_VALUE -> ".jpg";
                case MediaType.IMAGE_PNG_VALUE -> ".png";
                case "image/webp" -> ".webp";
                default -> throw new BusinessException("unsupported ticket image type: " + contentType);
            };
            encoded = imageBase64.substring(commaIndex + 1);
        }
        byte[] bytes;
        try {
            bytes = java.util.Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException exception) {
            throw new BusinessException("ticket image is not valid base64");
        }
        if (bytes.length == 0) {
            throw new BusinessException("ticket image is empty");
        }
        if (properties.maxImageSize() == null || properties.maxImageSize().toBytes() <= 0) {
            throw new BusinessException("upstream maximum image size must be configured and positive");
        }
        long maxBytes = properties.maxImageSize().toBytes();
        if (bytes.length > maxBytes) {
            throw new BusinessException("ticket image exceeds maximum size of " + maxBytes + " bytes");
        }
        return new DecodedImage(bytes, contentType, extension);
    }

    private void validateRecognizedTicket(MovieTicketInfo ticketInfo) {
        if (!StringUtils.hasText(ticketInfo.showId())) {
            throw new BusinessException("OCR result missing showId");
        }
        if (ticketInfo.seats() == null || ticketInfo.seats().isEmpty()) {
            throw new BusinessException("OCR result missing seats");
        }
        BigDecimal maxPrice;
        try {
            maxPrice = new BigDecimal(ticketInfo.maxPrice());
        } catch (NumberFormatException exception) {
            throw new BusinessException("OCR result has invalid max price", exception);
        }
        if (maxPrice.compareTo(BigDecimal.ZERO) <= 0) {
            throw new BusinessException("OCR result has invalid max price");
        }
    }

    private String requireText(String value, String message) {
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(message);
        }
        return value;
    }

    private String requiredString(Map<?, ?> source, String field, String context) {
        String value = optionalString(source, field, context);
        if (!StringUtils.hasText(value)) {
            throw new BusinessException(context + " is missing " + field);
        }
        return value;
    }

    private String optionalString(Map<?, ?> source, String field, String context) {
        Object value = source.get(field);
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text)) {
            throw new BusinessException(context + " field " + field + " must be a string");
        }
        return text;
    }

    private String firstText(Object... values) {
        for (Object value : values) {
            if (value != null && !(value instanceof String)) {
                throw new BusinessException("upstream reason field must be a string");
            }
            if (value instanceof String text && StringUtils.hasText(text)) {
                return text;
            }
        }
        return null;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException("unable to serialize upstream payload", exception);
        }
    }

    private Integer optionalInteger(Map<?, ?> source, String field, String context) {
        Object value = source.get(field);
        if (value == null) {
            return null;
        }
        if (!(value instanceof Number number)) {
            throw new BusinessException(context + " field " + field + " must be an integer");
        }
        return number.intValue();
    }

    private Integer requiredInteger(Map<?, ?> source, String field, String context) {
        Integer value = optionalInteger(source, field, context);
        if (value == null) {
            throw new BusinessException(context + " is missing " + field);
        }
        return value;
    }

    private record OfficialQuoteResult(
            String channel,
            BigDecimal price,
            String taskId,
            String raw
    ) {
    }

    private record DecodedImage(
            byte[] bytes,
            String contentType,
            String extension
    ) {
    }
}
