package com.movie.ticket.dto;

public record PiaoDaRenSmokeCheckItem(
        String name,
        boolean passed,
        String message
) {
}
