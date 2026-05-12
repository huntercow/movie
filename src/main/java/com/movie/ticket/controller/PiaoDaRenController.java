package com.movie.ticket.controller;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.PiaoDaRenLoginRequest;
import com.movie.ticket.dto.PiaoDaRenLoginResponse;
import com.movie.ticket.service.PiaoDaRenAuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/upstream/piaodaren")
public class PiaoDaRenController {

    private final PiaoDaRenAuthService authService;

    public PiaoDaRenController(PiaoDaRenAuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public ApiResponse<PiaoDaRenLoginResponse> login(@Valid @RequestBody PiaoDaRenLoginRequest request) {
        return ApiResponse.ok(authService.login(request));
    }
}
