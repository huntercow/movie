package com.movie.ticket.dto;

import jakarta.validation.constraints.NotBlank;

public record PiaoDaRenLoginRequest(
        @NotBlank(message = "userName is required")
        String userName,

        @NotBlank(message = "password is required")
        String password,

        String userTypeEnum
) {
}
