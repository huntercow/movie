package com.movie.ticket.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.dto.CreateQuoteRequest;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.dto.QuoteResponse;
import com.movie.ticket.entity.QuoteStatus;
import com.movie.ticket.entity.TicketQuote;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.repository.TicketQuoteRepository;
import com.movie.ticket.security.UserScopeContext;
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UploadedImage;
import com.movie.ticket.upstream.UpstreamQuote;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class QuoteService {

    private final TicketUpstreamClient upstreamClient;
    private final PricingService pricingService;
    private final TicketQuoteRepository quoteRepository;
    private final ObjectMapper objectMapper;

    public QuoteService(
            TicketUpstreamClient upstreamClient,
            PricingService pricingService,
            TicketQuoteRepository quoteRepository,
            ObjectMapper objectMapper
    ) {
        this.upstreamClient = upstreamClient;
        this.pricingService = pricingService;
        this.quoteRepository = quoteRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public QuoteResponse createQuote(CreateQuoteRequest request) {
        UploadedImage uploadedImage = upstreamClient.uploadImage(request.imageBase64());
//        log.info(uploadedImage.imageUrl());
        MovieTicketInfo ticketInfo = upstreamClient.recognizeTicket(uploadedImage.imageUrl());
//        log.info(ticketInfo.movieName());
        UpstreamQuote upstreamQuote = upstreamClient.quote(ticketInfo);
        BigDecimal maxPrice = parsePrice(ticketInfo.maxPrice(), "invalid max price from OCR");
        BigDecimal finalPrice = pricingService.calculateFinalPrice(upstreamQuote.price(), maxPrice);
        int ticketCount = requireTicketCount(ticketInfo.seatCount());
        BigDecimal totalPrice = finalPrice.multiply(BigDecimal.valueOf(ticketCount));
        BigDecimal totalProfit = finalPrice.subtract(upstreamQuote.price()).multiply(BigDecimal.valueOf(ticketCount));

        TicketQuote quote = new TicketQuote();
        quote.setQuoteNo(newQuoteNo());
        quote.setCustomerId(request.customerId());
        quote.setChannel(request.channel() == null ? null : request.channel().name());
        quote.setImageUrl(uploadedImage.imageUrl());
        quote.setUpstreamImageId(uploadedImage.upstreamImageId());
        quote.setOcrTaskId(ticketInfo.taskId());
        quote.setProvinceName(ticketInfo.provinceName());
        quote.setCityName(ticketInfo.cityName());
        quote.setAreaName(ticketInfo.areaName());
        quote.setCityCode(ticketInfo.cityCode());
        quote.setCinemaId(ticketInfo.cinemaId());
        quote.setCinemaCode(ticketInfo.cinemaCode());
        quote.setCinemaAddress(ticketInfo.cinemaAddress());
        quote.setFilmId(ticketInfo.filmId());
        quote.setFilmImg(ticketInfo.filmImg());
        quote.setCustomFilmType(ticketInfo.customFilmType());
        quote.setShowId(ticketInfo.showId());
        quote.setMovieName(ticketInfo.movieName());
        quote.setCinemaName(ticketInfo.cinemaName());
        quote.setShowTime(ticketInfo.showTime());
        quote.setHallName(ticketInfo.hallName());
        quote.setPlanType(ticketInfo.planType());
        quote.setSeatCount(ticketInfo.seatCount());
        quote.setSeatsJson(toJson(ticketInfo.seats()));
        quote.setSeatsAndPriceJson(toJson(ticketInfo.seatsAndPrice()));
        quote.setMaxPrice(ticketInfo.maxPrice());
        quote.setTotalImagePrice(ticketInfo.totalImagePrice());
        quote.setUpstreamPrice(upstreamQuote.price());
        quote.setFinalPrice(finalPrice);
        quote.setTotalPrice(totalPrice);
        quote.setProfit(totalProfit);
        quote.setStatus(QuoteStatus.CREATED);
        quote.setUpstreamRawResponse(upstreamQuote.rawResponse());
        quote.setOfficialQuotationId(upstreamQuote.taskId());
        quote.setOfficialQuotationChannel(upstreamQuote.selectedChannel());
        quoteRepository.save(quote);

        return toResponse(quote);
    }

    public QuoteResponse getQuote(String quoteNo) {
        return findQuote(quoteNo)
                .map(this::toResponse)
                .orElseThrow(() -> new BusinessException("quote not found"));
    }

    public List<QuoteResponse> listCurrentUserQuotes() {
        Long userId = UserScopeContext.get();
        if (userId == null) {
            throw new BusinessException("user context is required");
        }
        return quoteRepository.findTop100ByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(this::toResponse)
                .toList();
    }

    TicketQuote requireQuote(String quoteNo) {
        return findQuote(quoteNo)
                .orElseThrow(() -> new BusinessException("quote not found"));
    }

    TicketQuote requireQuoteForUpdate(String quoteNo) {
        Long userId = UserScopeContext.get();
        return (userId == null
                ? quoteRepository.findByQuoteNoForUpdate(quoteNo)
                : quoteRepository.findByUserIdAndQuoteNoForUpdate(userId, quoteNo))
                .orElseThrow(() -> new BusinessException("quote not found"));
    }

    private java.util.Optional<TicketQuote> findQuote(String quoteNo) {
        Long userId = UserScopeContext.get();
        return userId == null
                ? quoteRepository.findByQuoteNo(quoteNo)
                : quoteRepository.findByUserIdAndQuoteNo(userId, quoteNo);
    }

    private QuoteResponse toResponse(TicketQuote quote) {
        MovieTicketInfo ticketInfo = new MovieTicketInfo(
                quote.getOcrTaskId(),
                quote.getProvinceName(),
                quote.getCityName(),
                quote.getAreaName(),
                quote.getCityCode(),
                quote.getCinemaId(),
                quote.getCinemaCode(),
                quote.getCinemaAddress(),
                quote.getFilmId(),
                quote.getFilmImg(),
                quote.getCustomFilmType(),
                quote.getShowId(),
                quote.getMovieName(),
                quote.getCinemaName(),
                quote.getShowTime(),
                quote.getHallName(),
                quote.getPlanType(),
                quote.getSeatCount(),
                parseStringList(quote.getSeatsJson()),
                parseStringMap(quote.getSeatsAndPriceJson()),
                quote.getMaxPrice(),
                quote.getTotalImagePrice(),
                quote.getImageUrl()
        );
        return new QuoteResponse(
                quote.getQuoteNo(),
                ticketInfo,
                quote.getUpstreamPrice(),
                quote.getFinalPrice(),
                quote.getTotalPrice(),
                quote.getProfit(),
                quote.getStatus().name()
        );
    }

    private String newQuoteNo() {
        return "Q" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(java.time.LocalDateTime.now())
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }

    private BigDecimal parsePrice(String value, String message) {
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException exception) {
            throw new BusinessException(message);
        }
    }

    private int requireTicketCount(Integer seatCount) {
        if (seatCount == null || seatCount <= 0) {
            throw new BusinessException("OCR result has invalid seat count");
        }
        return seatCount;
    }

    private String toJson(Object value) {
        if (value == null) {
            throw new BusinessException("quote JSON value is required");
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new BusinessException("unable to serialize quote JSON", exception);
        }
    }

    private List<String> parseStringList(String json) {
        if (json == null || json.isBlank()) {
            throw new BusinessException("stored quote seats JSON is missing");
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            throw new BusinessException("stored quote seats JSON is invalid", exception);
        }
    }

    private Map<String, String> parseStringMap(String json) {
        if (json == null || json.isBlank()) {
            throw new BusinessException("stored quote seat prices JSON is missing");
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            throw new BusinessException("stored quote seat prices JSON is invalid", exception);
        }
    }
}
