package com.movie.ticket.dto;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public record MovieTicketInfo(
        String showId,
        String movieName,
        String cinemaName,
        LocalDateTime showTime,
        String hallName,
        Integer seatCount,
        List<String> seats,
        Map<String, String> seatsAndPrice,
        String maxPrice,
        String imageUrl,
        String rawText
) {
}
