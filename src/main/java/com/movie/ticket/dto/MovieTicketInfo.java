package com.movie.ticket.dto;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public record MovieTicketInfo(
        String taskId,
        String provinceName,
        String cityName,
        String areaName,
        String cityCode,
        String cinemaId,
        String cinemaCode,
        String cinemaAddress,
        String filmId,
        String filmImg,
        Integer customFilmType,
        String showId,
        String movieName,
        String cinemaName,
        LocalDateTime showTime,
        String hallName,
        String planType,
        Integer seatCount,
        List<String> seats,
        Map<String, String> seatsAndPrice,
        String maxPrice,
        String totalImagePrice,
        String imageUrl
) {
}
