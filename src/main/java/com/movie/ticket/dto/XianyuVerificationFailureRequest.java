package com.movie.ticket.dto;

import com.movie.ticket.entity.XianyuVerificationFailureCode;
import jakarta.validation.constraints.NotNull;

public record XianyuVerificationFailureRequest(
        @NotNull(message = "code is required") XianyuVerificationFailureCode code
) {
}
