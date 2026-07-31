package com.movie.ticket.upstreamaccount;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpstreamAccountRequest(
        @NotBlank @Size(max = 64) String provider,
        @NotBlank @Size(max = 256) String username,
        @NotBlank @Size(max = 256) String password
) {
}
