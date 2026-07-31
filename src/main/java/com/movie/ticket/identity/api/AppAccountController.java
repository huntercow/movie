package com.movie.ticket.identity.api;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.identity.IdentityService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/app/account")
public class AppAccountController {

    private final IdentityService identityService;

    public AppAccountController(IdentityService identityService) {
        this.identityService = identityService;
    }

    @GetMapping("/me")
    public ApiResponse<UserView> me() {
        return ApiResponse.ok(identityService.me());
    }

    @PostMapping("/change-password")
    public ApiResponse<UserView> changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        return ApiResponse.ok(identityService.changePassword(request.currentPassword(), request.newPassword()));
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpServletRequest request) {
        identityService.logout(bearerToken(request));
        return ApiResponse.ok(null);
    }

    private String bearerToken(HttpServletRequest request) {
        String value = request.getHeader("Authorization");
        return value != null && value.startsWith("Bearer ") ? value.substring(7).trim() : "";
    }
}
