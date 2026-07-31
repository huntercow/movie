package com.movie.ticket.upstreamaccount;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.PiaoDaRenLoginRequest;
import com.movie.ticket.dto.PiaoDaRenStatusResponse;
import com.movie.ticket.service.PiaoDaRenAuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/app/upstream-account")
public class AppUpstreamAccountController {

    private final UserUpstreamAccountService accountService;
    private final PiaoDaRenAuthService authService;

    public AppUpstreamAccountController(
            UserUpstreamAccountService accountService,
            PiaoDaRenAuthService authService
    ) {
        this.accountService = accountService;
        this.authService = authService;
    }

    @GetMapping
    public ApiResponse<UpstreamAccountView> get() {
        return ApiResponse.ok(accountService.get());
    }

    @PutMapping
    public ApiResponse<UpstreamAccountView> save(@Valid @RequestBody UpstreamAccountRequest request) {
        return ApiResponse.ok(accountService.save(request));
    }

    @PostMapping("/login")
    public ApiResponse<PiaoDaRenStatusResponse> login() {
        UserUpstreamAccountService.Credentials credentials = accountService.credentials();
        try {
            authService.login(new PiaoDaRenLoginRequest(
                    credentials.username(),
                    credentials.password(),
                    "Consume"
            ));
            accountService.recordLoginSuccess();
            return ApiResponse.ok(authService.getStatus());
        } catch (RuntimeException exception) {
            accountService.recordLoginFailure(exception.getMessage());
            throw exception;
        }
    }

    @GetMapping("/status")
    public ApiResponse<PiaoDaRenStatusResponse> status() {
        return ApiResponse.ok(authService.getStatus());
    }
}
