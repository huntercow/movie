package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentService;
import com.movie.ticket.dto.ApiResponse;
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
@RequestMapping("/api/v1/admin")
public class AdminAgentController {

    private final AgentService agentService;

    public AdminAgentController(AgentService agentService) {
        this.agentService = agentService;
    }

    @GetMapping("/agent-tokens")
    public ApiResponse<List<AdminAgentView>> list() {
        return ApiResponse.ok(agentService.listAllForAdmin());
    }

    @PutMapping("/agent-tokens/{tokenId}/expiry")
    public ApiResponse<AgentTokenView> updateExpiry(
            @PathVariable Long tokenId,
            @Valid @RequestBody UpdateAgentTokenExpiryRequest request,
            HttpServletRequest servletRequest
    ) {
        return ApiResponse.ok(agentService.updateExpiryForAdmin(tokenId, request.expiresAt(), servletRequest));
    }

    @PostMapping("/agent-tokens/{tokenId}/revoke")
    public ApiResponse<AgentTokenView> revoke(
            @PathVariable Long tokenId,
            HttpServletRequest servletRequest
    ) {
        return ApiResponse.ok(agentService.revokeForAdmin(tokenId, servletRequest));
    }
}
