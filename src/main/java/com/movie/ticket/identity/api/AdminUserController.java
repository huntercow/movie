package com.movie.ticket.identity.api;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.identity.AdminUserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/admin/users")
public class AdminUserController {

    private final AdminUserService userService;

    public AdminUserController(AdminUserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public ApiResponse<List<UserView>> listUsers() {
        return ApiResponse.ok(userService.listUsers());
    }

    @GetMapping("/{userId}")
    public ApiResponse<UserView> getUser(@PathVariable Long userId) {
        return ApiResponse.ok(userService.getUser(userId));
    }

    @PostMapping
    public ApiResponse<UserView> createUser(
            @Valid @RequestBody AdminCreateUserRequest request,
            HttpServletRequest servletRequest
    ) {
        return ApiResponse.ok(userService.createUser(request, servletRequest));
    }

    @PutMapping("/{userId}/status")
    public ApiResponse<UserView> updateStatus(
            @PathVariable Long userId,
            @Valid @RequestBody AdminUpdateUserStatusRequest request,
            HttpServletRequest servletRequest
    ) {
        return ApiResponse.ok(userService.updateStatus(userId, request.status(), servletRequest));
    }

    @PostMapping("/{userId}/reset-password")
    public ApiResponse<UserView> resetPassword(
            @PathVariable Long userId,
            @Valid @RequestBody AdminResetPasswordRequest request,
            HttpServletRequest servletRequest
    ) {
        return ApiResponse.ok(userService.resetPassword(userId, request.initialPassword(), servletRequest));
    }
}
