package com.movie.ticket.upstreamaccount;

import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.security.CredentialCipher;
import com.movie.ticket.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
public class UserUpstreamAccountService {

    private final UserUpstreamAccountRepository repository;
    private final CredentialCipher credentialCipher;
    private final CurrentUser currentUser;

    public UserUpstreamAccountService(
            UserUpstreamAccountRepository repository,
            CredentialCipher credentialCipher,
            CurrentUser currentUser
    ) {
        this.repository = repository;
        this.credentialCipher = credentialCipher;
        this.currentUser = currentUser;
    }

    @Transactional(readOnly = true)
    public UpstreamAccountView get() {
        return repository.findByUserId(currentUser.id())
                .map(this::toView)
                .orElse(new UpstreamAccountView(false, null, null, null, null, null, null, credentialCipher.isConfigured()));
    }

    @Transactional
    public UpstreamAccountView save(UpstreamAccountRequest request) {
        Long userId = currentUser.id();
        if (!"liangpiao-h5".equalsIgnoreCase(request.provider().trim())) {
            throw new BusinessException("unsupported upstream provider");
        }
        UserUpstreamAccount account = repository.findByUserId(userId).orElseGet(() -> {
            UserUpstreamAccount created = new UserUpstreamAccount();
            created.setUserId(userId);
            return created;
        });
        account.setProvider(request.provider().trim());
        account.setUsernameEncrypted(credentialCipher.encrypt(request.username().trim()));
        account.setPasswordEncrypted(credentialCipher.encrypt(request.password()));
        account.setStatus(UpstreamAccountStatus.CONFIGURED);
        account.setLastError(null);
        return toView(repository.save(account));
    }

    @Transactional(readOnly = true)
    public Credentials credentials() {
        Long userId = currentUser.id();
        UserUpstreamAccount account = repository.findByUserId(userId)
                .orElseThrow(() -> new BusinessException("upstream account is not configured"));
        if (account.getStatus() == UpstreamAccountStatus.DISABLED) {
            throw new BusinessException("upstream account is disabled");
        }
        return new Credentials(
                account.getProvider(),
                credentialCipher.decrypt(account.getUsernameEncrypted()),
                credentialCipher.decrypt(account.getPasswordEncrypted())
        );
    }

    @Transactional
    public void recordLoginSuccess() {
        repository.findByUserId(currentUser.id()).ifPresent(account -> {
            account.setStatus(UpstreamAccountStatus.ACTIVE);
            account.setLastLoginAt(LocalDateTime.now());
            account.setLastError(null);
            repository.save(account);
        });
    }

    @Transactional
    public void recordLoginFailure(String message) {
        repository.findByUserId(currentUser.id()).ifPresent(account -> {
            account.setStatus(UpstreamAccountStatus.ERROR);
            account.setLastError(message);
            repository.save(account);
        });
    }

    private UpstreamAccountView toView(UserUpstreamAccount account) {
        return new UpstreamAccountView(
                true,
                account.getProvider(),
                maskUsername(credentialCipher.decrypt(account.getUsernameEncrypted())),
                account.getStatus(),
                account.getLastLoginAt(),
                account.getLastError(),
                account.getUpdatedAt(),
                credentialCipher.isConfigured()
        );
    }

    private String maskUsername(String username) {
        if (username == null || username.length() <= 2) {
            return "**";
        }
        return username.substring(0, 1) + "***" + username.substring(username.length() - 1);
    }

    public record Credentials(String provider, String username, String password) {
    }
}
