package com.movie.ticket.identity;

import com.movie.ticket.audit.AuditService;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.identity.api.AdminCreateUserRequest;
import com.movie.ticket.identity.api.UserView;
import com.movie.ticket.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;

@Service
public class AdminUserService {

    private final AppUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final CurrentUser currentUser;
    private final AuditService auditService;
    private final SessionAuthenticationService sessionAuthenticationService;

    public AdminUserService(
            AppUserRepository userRepository,
            PasswordEncoder passwordEncoder,
            CurrentUser currentUser,
            AuditService auditService,
            SessionAuthenticationService sessionAuthenticationService
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.currentUser = currentUser;
        this.auditService = auditService;
        this.sessionAuthenticationService = sessionAuthenticationService;
    }

    @Transactional(readOnly = true)
    public List<UserView> listUsers() {
        return userRepository.findAll(Sort.by(Sort.Direction.DESC, "createdAt")).stream()
                .map(UserView::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public UserView getUser(Long userId) {
        return UserView.from(requireUser(userId));
    }

    @Transactional
    public UserView createUser(AdminCreateUserRequest request, HttpServletRequest servletRequest) {
        String username = request.username().trim().toLowerCase(Locale.ROOT);
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw new BusinessException("username already exists");
        }
        AppUser user = new AppUser();
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(request.initialPassword()));
        user.setRole(UserRole.USER);
        user.setStatus(UserStatus.ACTIVE);
        user.setMustChangePassword(true);
        userRepository.saveAndFlush(user);
        UserView view = UserView.from(user);
        auditService.record(currentUser.id(), user.getId(), "USER_CREATED", "APP_USER", user.getId().toString(), null, view, servletRequest);
        return view;
    }

    @Transactional
    public UserView updateStatus(Long userId, UserStatus status, HttpServletRequest servletRequest) {
        AppUser user = requireNormalUser(userId);
        UserStatus before = user.getStatus();
        user.setStatus(status);
        userRepository.save(user);
        if (status == UserStatus.SUSPENDED) {
            sessionAuthenticationService.revokeAllForUser(userId);
        }
        auditService.record(currentUser.id(), userId, "USER_STATUS_UPDATED", "APP_USER", userId.toString(), before, status, servletRequest);
        return UserView.from(user);
    }

    @Transactional
    public UserView resetPassword(Long userId, String initialPassword, HttpServletRequest servletRequest) {
        AppUser user = requireNormalUser(userId);
        user.setPasswordHash(passwordEncoder.encode(initialPassword));
        user.setMustChangePassword(true);
        userRepository.save(user);
        sessionAuthenticationService.revokeAllForUser(userId);
        auditService.record(currentUser.id(), userId, "USER_PASSWORD_RESET", "APP_USER", userId.toString(), null, null, servletRequest);
        return UserView.from(user);
    }

    private AppUser requireNormalUser(Long userId) {
        AppUser user = requireUser(userId);
        if (user.getRole() == UserRole.ADMIN) {
            throw new BusinessException("administrator cannot be modified through user APIs");
        }
        return user;
    }

    private AppUser requireUser(Long userId) {
        return userRepository.findById(userId).orElseThrow(() -> new BusinessException("user not found"));
    }
}
