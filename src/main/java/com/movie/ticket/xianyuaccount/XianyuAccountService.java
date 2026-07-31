package com.movie.ticket.xianyuaccount;

import com.movie.ticket.audit.AuditService;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class XianyuAccountService {

    private final XianyuAccountRepository repository;
    private final CurrentUser currentUser;
    private final AuditService auditService;

    public XianyuAccountService(
            XianyuAccountRepository repository,
            CurrentUser currentUser,
            AuditService auditService
    ) {
        this.repository = repository;
        this.currentUser = currentUser;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public List<XianyuAccountView> list() {
        return repository.findAllByUserIdOrderByCreatedAtDesc(currentUser.id()).stream()
                .map(XianyuAccountView::from)
                .toList();
    }

    @Transactional
    public XianyuAccountView create(XianyuAccountRequest request, HttpServletRequest servletRequest) {
        Long userId = currentUser.id();
        repository.findByPlatformAccountId(request.platformAccountId().trim()).ifPresent(existing -> {
            throw new BusinessException("xianyu account is already registered");
        });
        XianyuAccount account = new XianyuAccount();
        account.setUserId(userId);
        apply(account, request);
        repository.save(account);
        XianyuAccountView view = XianyuAccountView.from(account);
        auditService.record(userId, userId, "XIANYU_ACCOUNT_CREATED", "XIANYU_ACCOUNT", account.getId().toString(), null, view, servletRequest);
        return view;
    }

    @Transactional
    public XianyuAccountView update(Long accountId, XianyuAccountRequest request, HttpServletRequest servletRequest) {
        Long userId = currentUser.id();
        XianyuAccount account = repository.findByIdAndUserId(accountId, userId)
                .orElseThrow(() -> new BusinessException("xianyu account not found"));
        XianyuAccountView before = XianyuAccountView.from(account);
        if (!account.getPlatformAccountId().equals(request.platformAccountId().trim())) {
            repository.findByPlatformAccountId(request.platformAccountId().trim()).ifPresent(existing -> {
                throw new BusinessException("xianyu account is already registered");
            });
        }
        apply(account, request);
        repository.save(account);
        XianyuAccountView after = XianyuAccountView.from(account);
        auditService.record(userId, userId, "XIANYU_ACCOUNT_UPDATED", "XIANYU_ACCOUNT", accountId.toString(), before, after, servletRequest);
        return after;
    }

    private void apply(XianyuAccount account, XianyuAccountRequest request) {
        account.setPlatformAccountId(request.platformAccountId().trim());
        account.setNickname(request.nickname() == null ? null : request.nickname().trim());
        account.setStatus(request.status());
    }
}
