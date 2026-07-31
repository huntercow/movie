package com.movie.ticket.controller.app;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.XianyuReplyConfigRequest;
import com.movie.ticket.dto.XianyuReplyConfigResponse;
import com.movie.ticket.service.XianyuReplyConfigService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/app/reply-config")
public class AppReplyConfigController {

    private final XianyuReplyConfigService service;

    public AppReplyConfigController(XianyuReplyConfigService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<XianyuReplyConfigResponse> get() {
        return ApiResponse.ok(service.getDefaultConfig());
    }

    @PutMapping
    public ApiResponse<XianyuReplyConfigResponse> save(@RequestBody XianyuReplyConfigRequest request) {
        return ApiResponse.ok(service.saveDefaultConfig(request));
    }
}
