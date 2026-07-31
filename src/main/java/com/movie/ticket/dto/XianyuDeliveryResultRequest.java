package com.movie.ticket.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;

public record XianyuDeliveryResultRequest(
        @NotBlank(message = "attemptId is required")
        String attemptId,
        @NotNull(message = "success is required")
        Boolean success,
        @NotBlank(message = "channel is required")
        String channel,
        String errorMessage
) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("unknown xianyu delivery result field: " + field);
    }
}
