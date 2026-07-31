package com.movie.ticket.identity.api;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.identity.IdentityService;
import com.movie.ticket.identity.AppUserRepository;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final IdentityService identityService;
    private final AppUserRepository userRepository;

    public AuthController(IdentityService identityService, AppUserRepository userRepository) {
        this.identityService = identityService;
        this.userRepository = userRepository;
    }

    @org.springframework.web.bind.annotation.GetMapping("/bootstrap-status")
    public ApiResponse<BootstrapStatusResponse> bootstrapStatus() {
        return ApiResponse.ok(new BootstrapStatusResponse(userRepository.count() > 0));
    }

    @PostMapping("/bootstrap")
    public ApiResponse<AuthResponse> bootstrap(@Valid @RequestBody BootstrapRequest request) {
        return ApiResponse.ok(identityService.bootstrap(request.username(), request.password()));
    }

    @PostMapping("/login")
    public ApiResponse<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return ApiResponse.ok(identityService.login(request.username(), request.password()));
    }
}
