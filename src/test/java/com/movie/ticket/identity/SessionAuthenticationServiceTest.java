package com.movie.ticket.identity;

import com.movie.ticket.security.SecretTokenService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SessionAuthenticationServiceTest {

    @Test
    void revokeAllForUserInvalidatesEveryOpenSession() {
        UserSessionRepository sessions = mock(UserSessionRepository.class);
        UserSession first = new UserSession();
        UserSession second = new UserSession();
        when(sessions.findAllByUserIdAndRevokedAtIsNull(12L)).thenReturn(List.of(first, second));
        when(sessions.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        SessionAuthenticationService service = new SessionAuthenticationService(
                sessions, mock(AppUserRepository.class), mock(SecretTokenService.class));

        service.revokeAllForUser(12L);

        assertThat(first.getRevokedAt()).isNotNull();
        assertThat(second.getRevokedAt()).isEqualTo(first.getRevokedAt());
        verify(sessions, org.mockito.Mockito.times(2)).save(any());
    }
}
