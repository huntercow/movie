package com.movie.ticket.dto;

public record PiaoDaRenLoginResponse(
        boolean loggedIn,
        String userToken,
        PiaoDaRenUserProfile profile
//        Object raw
) {
}
