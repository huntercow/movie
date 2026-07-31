package com.movie.ticket.agent;

import com.movie.ticket.agent.api.ActivateAgentRequest;
import com.movie.ticket.agent.api.AgentActivationResponse;
import com.movie.ticket.agent.api.AgentInstanceView;
import com.movie.ticket.agent.api.AgentTokenView;
import com.movie.ticket.agent.api.AdminAgentView;
import com.movie.ticket.agent.api.CreatedAgentTokenResponse;
import com.movie.ticket.audit.AuditService;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.identity.AppUser;
import com.movie.ticket.identity.AppUserRepository;
import com.movie.ticket.security.CurrentUser;
import com.movie.ticket.security.SecretTokenService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class AgentService {

    private static final List<AgentTokenStatus> OCCUPYING_STATUSES = List.of(
            AgentTokenStatus.PENDING,
            AgentTokenStatus.UNUSED,
            AgentTokenStatus.ACTIVE
    );

    private final AgentTokenRepository tokenRepository;
    private final AgentInstanceRepository instanceRepository;
    private final AppUserRepository userRepository;
    private final SecretTokenService secretTokenService;
    private final CurrentUser currentUser;
    private final AuditService auditService;

    public AgentService(
            AgentTokenRepository tokenRepository,
            AgentInstanceRepository instanceRepository,
            AppUserRepository userRepository,
            SecretTokenService secretTokenService,
            CurrentUser currentUser,
            AuditService auditService
    ) {
        this.tokenRepository = tokenRepository;
        this.instanceRepository = instanceRepository;
        this.userRepository = userRepository;
        this.secretTokenService = secretTokenService;
        this.currentUser = currentUser;
        this.auditService = auditService;
    }

    @Transactional
    public List<AgentTokenView> listMyTokens() {
        Long userId = currentUser.id();
        List<AgentToken> tokens = tokenRepository.findAllByUserIdOrderByCreatedAtDesc(userId);
        expirePastDueTokens(tokens);
        return tokens.stream()
                .map(this::toView)
                .toList();
    }

    @Transactional
    public List<AdminAgentView> listAllForAdmin() {
        List<AgentToken> tokens = tokenRepository.findAllByOrderByCreatedAtDesc();
        expirePastDueTokens(tokens);
        Map<Long, AppUser> users = userRepository.findAll().stream()
                .collect(Collectors.toMap(AppUser::getId, Function.identity()));
        return tokens.stream()
                .map(token -> {
                    AppUser user = users.get(token.getUserId());
                    return new AdminAgentView(
                            token.getUserId(),
                            user == null ? "deleted-user" : user.getUsername(),
                            user == null ? null : user.getStatus(),
                            toView(token)
                    );
                })
                .toList();
    }

    @Transactional
    public CreatedAgentTokenResponse createToken(
            AgentType type,
            HttpServletRequest request
    ) {
        Long userId = currentUser.id();
        AppUser user = userRepository.findById(userId).orElseThrow(() -> new BusinessException("user not found"));
        if (user.isMustChangePassword()) {
            throw new BusinessException("change the initial password before creating agent tokens");
        }
        String rawToken = secretTokenService.generate(type == AgentType.XIANYU_PLUGIN ? "plg_" : "bot_");
        AgentToken token = new AgentToken();
        token.setUserId(userId);
        token.setAgentType(type);
        token.setTokenPrefix(rawToken.substring(0, Math.min(12, rawToken.length())));
        token.setTokenHash(secretTokenService.hash(rawToken));
        token.setStatus(AgentTokenStatus.PENDING);
        token.setExpiresAt(null);
        tokenRepository.save(token);
        AgentTokenView view = toView(token);
        auditService.record(userId, userId, "AGENT_TOKEN_CREATED", "AGENT_TOKEN", token.getId().toString(), null, view, request);
        return new CreatedAgentTokenResponse(rawToken, view);
    }

    @Transactional
    public AgentTokenView updateExpiryForAdmin(
            Long tokenId,
            LocalDateTime requestedExpiry,
            HttpServletRequest request
    ) {
        AgentToken token = tokenRepository.findById(tokenId)
                .orElseThrow(() -> new BusinessException("agent token not found"));
        if (token.getStatus() == AgentTokenStatus.REVOKED) {
            throw new BusinessException("revoked token cannot be renewed");
        }
        AgentTokenView before = toView(token);
        token.setExpiresAt(effectiveExpiry(requestedExpiry));
        if (token.getStatus() == AgentTokenStatus.EXPIRED || token.getStatus() == AgentTokenStatus.PENDING) {
            token.setStatus(instanceRepository.findByAgentTokenId(tokenId).isPresent()
                    ? AgentTokenStatus.ACTIVE
                    : AgentTokenStatus.UNUSED);
        }
        tokenRepository.save(token);
        AgentTokenView after = toView(token);
        auditService.record(currentUser.id(), token.getUserId(), "AGENT_TOKEN_EXPIRY_UPDATED", "AGENT_TOKEN", tokenId.toString(), before, after, request);
        return after;
    }

    @Transactional
    public AgentActivationResponse activate(ActivateAgentRequest request) {
        AgentToken token = tokenRepository.findByTokenHashForUpdate(secretTokenService.hash(request.token()))
                .orElseThrow(() -> new BusinessException("invalid agent token"));
        requireUsableToken(token, request.agentType());
        requireActiveUser(token.getUserId());

        AgentInstance bound = instanceRepository.findByAgentTokenId(token.getId()).orElse(null);
        if (bound != null && !bound.getInstallationId().equals(request.installationId())) {
            throw new BusinessException("agent token is already bound to another installation");
        }
        AgentInstance installation = instanceRepository.findByInstallationId(request.installationId()).orElse(null);
        if (installation != null && !installation.getAgentTokenId().equals(token.getId())) {
            throw new BusinessException("installation is already bound to another agent token");
        }
        LocalDateTime now = LocalDateTime.now();
        AgentInstance instance = bound == null ? new AgentInstance() : bound;
        if (bound == null) {
            instance.setUserId(token.getUserId());
            instance.setAgentTokenId(token.getId());
            instance.setAgentType(token.getAgentType());
            instance.setInstallationId(request.installationId());
            instance.setActivatedAt(now);
        }
        instance.setInstanceName(request.instanceName());
        instance.setClientVersion(request.clientVersion());
        instance.setStatus(AgentInstanceStatus.ONLINE);
        instance.setLastHeartbeatAt(now);
        instance.setDisabledAt(null);
        updateCurrentXianyuAccount(
                instance,
                request.agentType(),
                request.currentXianyuAccountId(),
                request.currentXianyuNickname(),
                now
        );
        instanceRepository.save(instance);
        token.setStatus(AgentTokenStatus.ACTIVE);
        token.setLastUsedAt(now);
        tokenRepository.save(token);
        return new AgentActivationResponse(token.getUserId(), token.getAgentType(), AgentInstanceView.from(instance));
    }

    @Transactional
    public AgentActivationResponse heartbeat(
            String rawToken,
            AgentType type,
            String installationId,
            String clientVersion,
            String currentXianyuAccountId,
            String currentXianyuNickname
    ) {
        AgentAccess access = authenticateRuntime(rawToken, type, installationId);
        AgentInstance instance = instanceRepository.findById(access.instanceId()).orElseThrow();
        instance.setStatus(AgentInstanceStatus.ONLINE);
        instance.setClientVersion(clientVersion);
        LocalDateTime now = LocalDateTime.now();
        instance.setLastHeartbeatAt(now);
        updateCurrentXianyuAccount(instance, type, currentXianyuAccountId, currentXianyuNickname, now);
        instanceRepository.save(instance);
        return new AgentActivationResponse(access.userId(), type, AgentInstanceView.from(instance));
    }

    @Transactional
    public AgentAccess authenticateRuntime(String rawToken, AgentType type, String installationId) {
        if (installationId == null || installationId.isBlank()) {
            throw new BusinessException("agent installation id is required");
        }
        AgentToken token = tokenRepository.findByTokenHash(secretTokenService.hash(rawToken))
                .orElseThrow(() -> new BusinessException("invalid agent token"));
        requireUsableToken(token, type);
        requireActiveUser(token.getUserId());
        AgentInstance instance = instanceRepository.findByAgentTokenId(token.getId())
                .orElseThrow(() -> new BusinessException("agent token is not activated"));
        if (!instance.getInstallationId().equals(installationId)
                || instance.getStatus() == AgentInstanceStatus.DISABLED) {
            throw new BusinessException("agent installation is not authorized");
        }
        token.setLastUsedAt(LocalDateTime.now());
        tokenRepository.save(token);
        return new AgentAccess(token.getUserId(), token.getId(), instance.getId(), type);
    }

    @Transactional
    public AgentTokenView resetBinding(Long tokenId, HttpServletRequest request) {
        AgentToken token = requireOwnedToken(tokenId);
        if (token.getStatus() == AgentTokenStatus.REVOKED) {
            throw new BusinessException("revoked token cannot be rebound");
        }
        instanceRepository.findByAgentTokenId(tokenId).ifPresent(instanceRepository::delete);
        if (token.getStatus() == AgentTokenStatus.ACTIVE) {
            token.setStatus(AgentTokenStatus.UNUSED);
        }
        token.setLastUsedAt(null);
        tokenRepository.save(token);
        auditService.record(currentUser.id(), token.getUserId(), "AGENT_TOKEN_UNBOUND", "AGENT_TOKEN", tokenId.toString(), null, toView(token), request);
        return toView(token);
    }

    @Transactional
    public AgentTokenView revokeForAdmin(Long tokenId, HttpServletRequest request) {
        AgentToken token = tokenRepository.findById(tokenId)
                .orElseThrow(() -> new BusinessException("agent token not found"));
        return revokeToken(token, request);
    }

    @Transactional
    public AgentTokenView revokeOwned(Long tokenId, HttpServletRequest request) {
        return revokeToken(requireOwnedToken(tokenId), request);
    }

    private AgentTokenView revokeToken(AgentToken token, HttpServletRequest request) {
        Long tokenId = token.getId();
        token.setStatus(AgentTokenStatus.REVOKED);
        tokenRepository.save(token);
        instanceRepository.findByAgentTokenId(tokenId).ifPresent(instance -> {
            instance.setStatus(AgentInstanceStatus.DISABLED);
            instance.setDisabledAt(LocalDateTime.now());
            instanceRepository.save(instance);
        });
        AgentTokenView view = toView(token);
        auditService.record(currentUser.id(), token.getUserId(), "AGENT_TOKEN_REVOKED", "AGENT_TOKEN", tokenId.toString(), null, view, request);
        return view;
    }

    private AgentToken requireOwnedToken(Long tokenId) {
        AgentToken token = tokenRepository.findById(tokenId)
                .orElseThrow(() -> new BusinessException("agent token not found"));
        if (!token.getUserId().equals(currentUser.id())) {
            throw new BusinessException("agent token not found");
        }
        return token;
    }

    private AgentTokenView toView(AgentToken token) {
        AgentInstanceView instance = instanceRepository.findByAgentTokenId(token.getId())
                .map(AgentInstanceView::from)
                .orElse(null);
        return AgentTokenView.from(token, instance);
    }

    private void requireUsableToken(AgentToken token, AgentType expectedType) {
        if (token.getAgentType() != expectedType) {
            throw new BusinessException("agent token type does not match client type");
        }
        if (token.getStatus() == AgentTokenStatus.REVOKED) {
            throw new BusinessException("agent token is revoked");
        }
        if (token.getStatus() == AgentTokenStatus.PENDING) {
            throw new BusinessException("agent token is pending administrator approval");
        }
        if (token.getStatus() == AgentTokenStatus.EXPIRED) {
            throw new BusinessException("agent token is expired");
        }
        if (token.getExpiresAt() == null) {
            token.setStatus(AgentTokenStatus.PENDING);
            tokenRepository.save(token);
            throw new BusinessException("agent token is pending administrator approval");
        }
        if (token.getExpiresAt() != null && !token.getExpiresAt().isAfter(LocalDateTime.now())) {
            token.setStatus(AgentTokenStatus.EXPIRED);
            tokenRepository.save(token);
            throw new BusinessException("agent token is expired");
        }
    }

    private void requireActiveUser(Long userId) {
        AppUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException("agent user is not active"));
        if (user.getStatus() != com.movie.ticket.identity.UserStatus.ACTIVE) {
            throw new BusinessException("agent user is not active");
        }
    }

    private void expirePastDueTokens(List<AgentToken> tokens) {
        LocalDateTime now = LocalDateTime.now();
        tokens.stream()
                .filter(token -> OCCUPYING_STATUSES.contains(token.getStatus()))
                .filter(token -> token.getExpiresAt() != null && !token.getExpiresAt().isAfter(now))
                .forEach(token -> {
                    token.setStatus(AgentTokenStatus.EXPIRED);
                    tokenRepository.save(token);
                });
    }

    private void updateCurrentXianyuAccount(
            AgentInstance instance,
            AgentType type,
            String accountId,
            String nickname,
            LocalDateTime now
    ) {
        if (type != AgentType.XIANYU_PLUGIN || accountId == null) {
            return;
        }
        String normalizedAccountId = normalizeNullable(accountId);
        String normalizedNickname = normalizeNullable(nickname);
        if (java.util.Objects.equals(instance.getCurrentXianyuAccountId(), normalizedAccountId)
                && java.util.Objects.equals(instance.getCurrentXianyuNickname(), normalizedNickname)) {
            return;
        }
        instance.setCurrentXianyuAccountId(normalizedAccountId);
        instance.setCurrentXianyuNickname(normalizedAccountId == null ? null : normalizedNickname);
        instance.setXianyuAccountUpdatedAt(now);
    }

    private String normalizeNullable(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }

    private LocalDateTime effectiveExpiry(LocalDateTime requested) {
        if (requested == null) {
            throw new BusinessException("agent token expiry is required");
        }
        if (!requested.isAfter(LocalDateTime.now())) {
            throw new BusinessException("agent token expiry must be in the future");
        }
        return requested;
    }
}
