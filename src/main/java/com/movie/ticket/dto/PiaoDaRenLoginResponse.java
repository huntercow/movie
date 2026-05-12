package com.movie.ticket.dto;

public record PiaoDaRenLoginResponse(
        boolean loggedIn,
        String userToken,
        Object raw
) {
}
