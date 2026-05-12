package com.movie.ticket.service;

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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.StringJoiner;
import java.util.UUID;

@Service
public class QuoteService {

    private final TicketUpstreamClient upstreamClient;
    private final PricingService pricingService;
    private final TicketQuoteRepository quoteRepository;

    public QuoteService(TicketUpstreamClient upstreamClient, PricingService pricingService, TicketQuoteRepository quoteRepository) {
        this.upstreamClient = upstreamClient;
        this.pricingService = pricingService;
        this.quoteRepository = quoteRepository;
    }

    @Transactional
    public QuoteResponse createQuote(CreateQuoteRequest request) {
        UploadedImage uploadedImage = upstreamClient.uploadImage(request.imageBase64());
        MovieTicketInfo ticketInfo = upstreamClient.recognizeTicket(uploadedImage.imageUrl());
        UpstreamQuote upstreamQuote = upstreamClient.quote(ticketInfo);
        BigDecimal finalPrice = pricingService.calculateFinalPrice(upstreamQuote.price());

        TicketQuote quote = new TicketQuote();
        quote.setQuoteNo(newQuoteNo());
        quote.setCustomerId(request.customerId());
        quote.setChannel(request.channel());
        quote.setImageUrl(uploadedImage.imageUrl());
        quote.setUpstreamImageId(uploadedImage.upstreamImageId());
        quote.setShowId(ticketInfo.showId());
        quote.setMovieName(ticketInfo.movieName());
        quote.setCinemaName(ticketInfo.cinemaName());
        quote.setShowTime(ticketInfo.showTime());
        quote.setHallName(ticketInfo.hallName());
        quote.setSeatCount(ticketInfo.seatCount());
        quote.setSeatsJson(toSimpleJsonArray(ticketInfo.seats()));
        quote.setMaxPrice(ticketInfo.maxPrice());
        quote.setRawOcrText(ticketInfo.rawText());
        quote.setUpstreamPrice(upstreamQuote.price());
        quote.setFinalPrice(finalPrice);
        quote.setProfit(finalPrice.subtract(upstreamQuote.price()));
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
                quote.getShowId(),
                quote.getMovieName(),
                quote.getCinemaName(),
                quote.getShowTime(),
                quote.getHallName(),
                quote.getSeatCount(),
                null,
                null,
                quote.getMaxPrice(),
                quote.getImageUrl(),
                quote.getRawOcrText()
        );
        return new QuoteResponse(
                quote.getQuoteNo(),
                ticketInfo,
                quote.getUpstreamPrice(),
                quote.getFinalPrice(),
                quote.getProfit(),
                quote.getStatus().name()
        );
    }

    private String newQuoteNo() {
        return "Q" + DateTimeFormatter.ofPattern("yyyyMMddHHmmss").format(java.time.LocalDateTime.now())
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }

    private String toSimpleJsonArray(java.util.List<String> values) {
        if (values == null) {
            return "[]";
        }
        StringJoiner joiner = new StringJoiner(",", "[", "]");
        for (String value : values) {
            joiner.add("\"" + value.replace("\"", "\\\"") + "\"");
        }
        return joiner.toString();
    }
}
