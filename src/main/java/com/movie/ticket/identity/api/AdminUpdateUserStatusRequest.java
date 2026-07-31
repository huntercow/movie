package com.movie.ticket.identity.api;

import com.movie.ticket.identity.UserStatus;
import jakarta.validation.constraints.NotNull;

public record AdminUpdateUserStatusRequest(@NotNull UserStatus status) {
}
