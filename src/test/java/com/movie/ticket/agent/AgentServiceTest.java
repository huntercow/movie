package com.movie.ticket.agent;

import com.movie.ticket.agent.api.ActivateAgentRequest;
import com.movie.ticket.audit.AuditService;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.identity.AppUserRepository;
import com.movie.ticket.identity.AppUser;
import com.movie.ticket.identity.UserStatus;
import com.movie.ticket.security.CurrentUser;
import com.movie.ticket.security.SecretTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AgentServiceTest {

    private AgentTokenRepository tokens;
    private AgentInstanceRepository instances;
    private SecretTokenService secrets;
    private AppUserRepository users;
    private CurrentUser currentUser;
    private AgentService service;

    @BeforeEach
    void setUp() {
        tokens = mock(AgentTokenRepository.class);
        instances = mock(AgentInstanceRepository.class);
        secrets = mock(SecretTokenService.class);
        users = mock(AppUserRepository.class);
        currentUser = mock(CurrentUser.class);
        service = new AgentService(tokens, instances, users, secrets,
                currentUser, mock(AuditService.class));
        AppUser activeUser = new AppUser();
        activeUser.setId(8L);
        activeUser.setStatus(UserStatus.ACTIVE);
        when(users.findById(8L)).thenReturn(Optional.of(activeUser));
    }

    @Test
    void tokenBoundToOneInstallationRejectsASecondInstallation() {
        AgentToken token = usableToken();
        AgentInstance bound = new AgentInstance();
        bound.setAgentTokenId(31L);
        bound.setInstallationId("installation-a");
        when(secrets.hash("plg_secret")).thenReturn("hash");
        when(tokens.findByTokenHashForUpdate("hash")).thenReturn(Optional.of(token));
        when(instances.findByAgentTokenId(31L)).thenReturn(Optional.of(bound));

        assertThatThrownBy(() -> service.activate(new ActivateAgentRequest(
                "plg_secret", AgentType.XIANYU_PLUGIN, "installation-b", "second", "1.0", null, null)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("agent token is already bound to another installation");
    }

    @Test
    void activatingPluginReplacesAndClearsItsCurrentXianyuAccountSnapshot() {
        AgentToken token = usableToken();
        AgentInstance bound = new AgentInstance();
        bound.setId(41L);
        bound.setAgentTokenId(31L);
        bound.setAgentType(AgentType.XIANYU_PLUGIN);
        bound.setInstallationId("installation-a");
        when(secrets.hash("plg_secret")).thenReturn("hash");
        when(tokens.findByTokenHashForUpdate("hash")).thenReturn(Optional.of(token));
        when(instances.findByAgentTokenId(31L)).thenReturn(Optional.of(bound));
        when(instances.findByInstallationId("installation-a")).thenReturn(Optional.of(bound));

        service.activate(new ActivateAgentRequest(
                "plg_secret", AgentType.XIANYU_PLUGIN, "installation-a", "plugin", "1.0",
                "seller-a", "Seller A"));
        assertThat(bound.getCurrentXianyuAccountId()).isEqualTo("seller-a");
        assertThat(bound.getCurrentXianyuNickname()).isEqualTo("Seller A");
        assertThat(bound.getXianyuAccountUpdatedAt()).isNotNull();

        service.activate(new ActivateAgentRequest(
                "plg_secret", AgentType.XIANYU_PLUGIN, "installation-a", "plugin", "1.0",
                "", ""));
        assertThat(bound.getCurrentXianyuAccountId()).isNull();
        assertThat(bound.getCurrentXianyuNickname()).isNull();
    }

    @Test
    void suspendedUserCannotUseAnActivatedToken() {
        AgentToken token = usableToken();
        AppUser suspended = new AppUser();
        suspended.setId(8L);
        suspended.setStatus(UserStatus.SUSPENDED);
        when(users.findById(8L)).thenReturn(Optional.of(suspended));
        when(secrets.hash("plg_secret")).thenReturn("hash");
        when(tokens.findByTokenHash("hash")).thenReturn(Optional.of(token));

        assertThatThrownBy(() -> service.authenticateRuntime("plg_secret", AgentType.XIANYU_PLUGIN, "installation-a"))
                .isInstanceOf(BusinessException.class)
                .hasMessage("agent user is not active");
    }

    @Test
    void userCreatedTokenWaitsForAdministratorExpiryApproval() {
        AppUser user = new AppUser();
        user.setId(8L);
        user.setStatus(UserStatus.ACTIVE);
        user.setMustChangePassword(false);
        when(currentUser.id()).thenReturn(8L);
        when(users.findById(8L)).thenReturn(Optional.of(user));
        when(secrets.generate("plg_")).thenReturn("plg_12345678901234567890");
        when(secrets.hash("plg_12345678901234567890")).thenReturn("new-hash");
        when(tokens.save(org.mockito.ArgumentMatchers.any())).thenAnswer(invocation -> {
            AgentToken saved = invocation.getArgument(0);
            saved.setId(99L);
            return saved;
        });

        var created = service.createToken(AgentType.XIANYU_PLUGIN, null);

        assertThat(created.details().status()).isEqualTo(AgentTokenStatus.PENDING);
        assertThat(created.details().expiresAt()).isNull();
    }

    @Test
    void administratorExpiryApprovalMakesPendingTokenUsable() {
        AgentToken pending = usableToken();
        pending.setStatus(AgentTokenStatus.PENDING);
        pending.setExpiresAt(null);
        LocalDateTime approvedExpiry = LocalDateTime.now().plusDays(10);
        when(tokens.findById(31L)).thenReturn(Optional.of(pending));
        var approved = service.updateExpiryForAdmin(31L, approvedExpiry, null);

        assertThat(approved.status()).isEqualTo(AgentTokenStatus.UNUSED);
        assertThat(approved.expiresAt()).isEqualTo(approvedExpiry);
    }

    @Test
    void pendingTokenCannotActivateBeforeAdministratorApproval() {
        AgentToken pending = usableToken();
        pending.setStatus(AgentTokenStatus.PENDING);
        pending.setExpiresAt(null);
        when(secrets.hash("plg_secret")).thenReturn("hash");
        when(tokens.findByTokenHashForUpdate("hash")).thenReturn(Optional.of(pending));

        assertThatThrownBy(() -> service.activate(new ActivateAgentRequest(
                "plg_secret", AgentType.XIANYU_PLUGIN, "installation-a", "plugin", "1.0", null, null)))
                .isInstanceOf(BusinessException.class)
                .hasMessage("agent token is pending administrator approval");
    }

    private AgentToken usableToken() {
        AgentToken token = new AgentToken();
        token.setId(31L);
        token.setUserId(8L);
        token.setAgentType(AgentType.XIANYU_PLUGIN);
        token.setStatus(AgentTokenStatus.ACTIVE);
        token.setExpiresAt(LocalDateTime.now().plusDays(1));
        return token;
    }
}
