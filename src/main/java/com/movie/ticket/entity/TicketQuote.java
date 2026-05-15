package com.movie.ticket.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter
@Setter
@Entity
public class TicketQuote {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String quoteNo;

    private String customerId;

    private String channel;

    private String imageUrl;
    private String upstreamImageId;
    private String ocrTaskId;
    private String provinceName;
    private String cityName;
    private String areaName;
    private String cityCode;
    private String cinemaId;
    private String cinemaCode;
    private String cinemaAddress;
    private String filmId;
    @Column(length = 512)
    private String filmImg;
    private Integer customFilmType;
    private String showId;
    private String movieName;
    private String cinemaName;
    private LocalDateTime showTime;
    private String hallName;
    private String planType;
    private Integer seatCount;
    @Column(length = 1024)
    private String seatsJson;
    @Column(length = 2048)
    private String seatsAndPriceJson;
    private String maxPrice;
    private String totalImagePrice;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal upstreamPrice;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal finalPrice;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal totalPrice;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal profit;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private QuoteStatus status;

    @Column(length = 2048)
    private String upstreamRawResponse;
    private String officialQuotationId;
    private String officialQuotationChannel;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void prePersist() {
        LocalDateTime now = LocalDateTime.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
