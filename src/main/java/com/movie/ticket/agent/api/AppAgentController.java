package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentService;
import com.movie.ticket.dto.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/app/agents")
public class AppAgentController {

    private final AgentService agentService;

    public AppAgentController(AgentService agentService) {
        this.agentService = agentService;
    }

    @GetMapping
    public ApiResponse<List<AgentTokenView>> list() {
        return ApiResponse.ok(agentService.listMyTokens());
    }

    @PostMapping("/tokens")
    public ApiResponse<CreatedAgentTokenResponse> createToken(
            @Valid @RequestBody CreateAgentTokenRequest request,
            HttpServletRequest servletRequest
    ) {
        return ApiResponse.ok(agentService.createToken(request.agentType(), servletRequest));
    }

    @PostMapping("/tokens/{tokenId}/unbind")
    public ApiResponse<AgentTokenView> unbind(@PathVariable Long tokenId, HttpServletRequest request) {
        return ApiResponse.ok(agentService.resetBinding(tokenId, request));
    }

    @PostMapping("/tokens/{tokenId}/revoke")
    public ApiResponse<AgentTokenView> revoke(@PathVariable Long tokenId, HttpServletRequest request) {
        return ApiResponse.ok(agentService.revokeOwned(tokenId, request));
    }

}
