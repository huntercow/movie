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
import com.movie.ticket.upstream.TicketUpstreamClient;
import com.movie.ticket.upstream.UploadedImage;
import com.movie.ticket.upstream.UpstreamQuote;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
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
        int ticketCount = ticketCount(ticketInfo.seatCount());
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
        quoteRepository.save(quote);

        return toResponse(quote);
    }

    public QuoteResponse getQuote(String quoteNo) {
        return quoteRepository.findByQuoteNo(quoteNo)
                .map(this::toResponse)
                .orElseThrow(() -> new BusinessException("quote not found"));
    }

    TicketQuote requireQuote(String quoteNo) {
        return quoteRepository.findByQuoteNo(quoteNo)
                .orElseThrow(() -> new BusinessException("quote not found"));
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

    private int ticketCount(Integer seatCount) {
        return seatCount == null || seatCount <= 0 ? 1 : seatCount;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? List.of() : value);
        } catch (JsonProcessingException exception) {
            return "[]";
        }
    }

    private List<String> parseStringList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            return List.of();
        }
    }

    private Map<String, String> parseStringMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }
}
