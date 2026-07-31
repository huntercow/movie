package com.movie.ticket.identity;

import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.identity.api.AuthResponse;
import com.movie.ticket.identity.api.UserView;
import com.movie.ticket.security.CurrentUser;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
public class IdentityService {

    private final AppUserRepository userRepository;
    private final SessionAuthenticationService sessionAuthenticationService;
    private final PasswordEncoder passwordEncoder;
    private final CurrentUser currentUser;
    private final LegacyDataOwnershipService legacyDataOwnershipService;

    public IdentityService(
            AppUserRepository userRepository,
            SessionAuthenticationService sessionAuthenticationService,
            PasswordEncoder passwordEncoder,
            CurrentUser currentUser,
            LegacyDataOwnershipService legacyDataOwnershipService
    ) {
        this.userRepository = userRepository;
        this.sessionAuthenticationService = sessionAuthenticationService;
        this.passwordEncoder = passwordEncoder;
        this.currentUser = currentUser;
        this.legacyDataOwnershipService = legacyDataOwnershipService;
    }

    @Transactional
    public synchronized AuthResponse bootstrap(String username, String password) {
        if (userRepository.count() != 0) {
            throw new BusinessException("administrator has already been initialized");
        }
        AppUser admin = new AppUser();
        admin.setUsername(normalizeUsername(username));
        admin.setPasswordHash(passwordEncoder.encode(password));
        admin.setRole(UserRole.ADMIN);
        admin.setStatus(UserStatus.ACTIVE);
        admin.setMustChangePassword(false);
        userRepository.saveAndFlush(admin);
        legacyDataOwnershipService.claimExistingData(admin.getId());
        return issue(admin);
    }

    @Transactional
    public AuthResponse login(String username, String password) {
        AppUser user = userRepository.findByUsernameIgnoreCase(normalizeUsername(username))
                .orElseThrow(() -> new BusinessException("invalid username or password"));
        if (user.getStatus() != UserStatus.ACTIVE || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new BusinessException("invalid username or password");
        }
        user.setLastLoginAt(LocalDateTime.now());
        userRepository.save(user);
        return issue(user);
    }

    @Transactional(readOnly = true)
    public UserView me() {
        AppUser user = userRepository.findById(currentUser.id())
                .orElseThrow(() -> new BusinessException("user not found"));
        return toView(user);
    }

    @Transactional
    public UserView changePassword(String currentPassword, String newPassword) {
        AppUser user = userRepository.findById(currentUser.id())
                .orElseThrow(() -> new BusinessException("user not found"));
        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new BusinessException("current password is incorrect");
        }
        if (passwordEncoder.matches(newPassword, user.getPasswordHash())) {
            throw new BusinessException("new password must be different");
        }
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setMustChangePassword(false);
        userRepository.save(user);
        return toView(user);
    }

    public void logout(String rawToken) {
        sessionAuthenticationService.revoke(rawToken);
    }

    public UserView toView(AppUser user) {
        return UserView.from(user);
    }

    private AuthResponse issue(AppUser user) {
        SessionAuthenticationService.IssuedSession session = sessionAuthenticationService.issue(user);
        return new AuthResponse(session.token(), session.expiresAt(), toView(user));
    }

    private String normalizeUsername(String username) {
        return username == null ? "" : username.trim().toLowerCase(java.util.Locale.ROOT);
    }
}
