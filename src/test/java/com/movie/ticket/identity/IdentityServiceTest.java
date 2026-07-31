package com.movie.ticket.identity;

import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.security.CurrentUser;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class IdentityServiceTest {

    @Test
    void bootstrapCreatesOnlyTheFirstAdministrator() {
        AppUserRepository users = mock(AppUserRepository.class);
        SessionAuthenticationService sessions = mock(SessionAuthenticationService.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        LegacyDataOwnershipService ownership = mock(LegacyDataOwnershipService.class);
        when(users.count()).thenReturn(0L, 1L);
        when(encoder.encode("strong-password")).thenReturn("hash");
        when(users.saveAndFlush(any())).thenAnswer(invocation -> {
            AppUser user = invocation.getArgument(0);
            user.setId(7L);
            return user;
        });
        when(sessions.issue(any())).thenReturn(new SessionAuthenticationService.IssuedSession(
                "usr_token", LocalDateTime.now().plusHours(12)));
        IdentityService service = new IdentityService(
                users, sessions, encoder, mock(CurrentUser.class), ownership);

        var response = service.bootstrap(" RootAdmin ", "strong-password");

        assertThat(response.user().username()).isEqualTo("rootadmin");
        assertThat(response.user().role()).isEqualTo(UserRole.ADMIN);
        verify(ownership).claimExistingData(7L);
        assertThatThrownBy(() -> service.bootstrap("other", "strong-password"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("already been initialized");
    }
}
