package com.movie.ticket.xianyuaccount;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record XianyuAccountRequest(
        @NotBlank @Size(max = 128) String platformAccountId,
        @Size(max = 128) String nickname,
        @NotNull XianyuAccountStatus status
) {
}
