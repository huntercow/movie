package com.movie.ticket.controller;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.PiaoDaRenLoginRequest;
import com.movie.ticket.dto.PiaoDaRenLoginResponse;
import com.movie.ticket.dto.PiaoDaRenSmokeCheckResponse;
import com.movie.ticket.dto.PiaoDaRenStatusResponse;
import com.movie.ticket.service.PiaoDaRenAuthService;
import com.movie.ticket.upstream.LiangPiaoH5Client;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.validation.Valid;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/upstream/piaodaren")
@SecurityRequirement(name = "adminToken")
public class PiaoDaRenController {

    private final PiaoDaRenAuthService authService;
    private final ObjectProvider<LiangPiaoH5Client> liangPiaoH5Client;

    public PiaoDaRenController(PiaoDaRenAuthService authService, ObjectProvider<LiangPiaoH5Client> liangPiaoH5Client) {
        this.authService = authService;
        this.liangPiaoH5Client = liangPiaoH5Client;
    }

    @GetMapping("/status")
    public ApiResponse<PiaoDaRenStatusResponse> status() {
        return ApiResponse.ok(authService.getStatus());
    }

    @GetMapping("/smoke")
    public ApiResponse<PiaoDaRenSmokeCheckResponse> smoke() {
        return ApiResponse.ok(authService.smokeCheck());
    }

    @PostMapping("/login")
    public ApiResponse<PiaoDaRenLoginResponse> login(@Valid @RequestBody PiaoDaRenLoginRequest request) {
        return ApiResponse.ok(authService.login(request));
    }

    @PostMapping("/login/configured")
    public ApiResponse<PiaoDaRenLoginResponse> loginConfigured() {
        return ApiResponse.ok(authService.loginConfiguredAccount());
    }

    @GetMapping("/h5/probe")
    public ApiResponse<Map<String, Object>> h5Probe() {
        LiangPiaoH5Client client = liangPiaoH5Client.getIfAvailable();
        if (client == null) {
            return ApiResponse.ok(Map.of("available", false));
        }
        String html = client.getH5IndexProbe();
        return ApiResponse.ok(Map.of(
                "available", true,
                "length", html == null ? 0 : html.length(),
                "title", extractTitle(html)
        ));
    }

    private String extractTitle(String html) {
        if (html == null) {
            return "";
        }
        int start = html.indexOf("<title>");
        int end = html.indexOf("</title>");
        if (start < 0 || end <= start) {
            return "";
        }
        return html.substring(start + "<title>".length(), end);
    }
}
