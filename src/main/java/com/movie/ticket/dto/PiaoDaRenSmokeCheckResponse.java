package com.movie.ticket.dto;

import java.util.List;

public record PiaoDaRenSmokeCheckResponse(
        String provider,
        boolean mockEnabled,
        boolean configuredCredentials,
        boolean loggedIn,
        String baseUrl,
        String h5BaseUrl,
        List<PiaoDaRenSmokeCheckItem> checks,
        List<String> safeActions,
        List<String> guardedActions
) {
}
