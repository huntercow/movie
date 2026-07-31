package com.movie.ticket.agent.api;

import com.movie.ticket.agent.AgentService;
import com.movie.ticket.dto.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/agents")
public class AgentActivationController {

    private final AgentService agentService;

    public AgentActivationController(AgentService agentService) {
        this.agentService = agentService;
    }

    @PostMapping("/activate")
    public ApiResponse<AgentActivationResponse> activate(@Valid @RequestBody ActivateAgentRequest request) {
        return ApiResponse.ok(agentService.activate(request));
    }

    @PostMapping("/heartbeat")
    public ApiResponse<AgentActivationResponse> heartbeat(@Valid @RequestBody AgentHeartbeatRequest request) {
        return ApiResponse.ok(agentService.heartbeat(
                request.token(),
                request.agentType(),
                request.installationId(),
                request.clientVersion(),
                request.currentXianyuAccountId(),
                request.currentXianyuNickname()
        ));
    }
}
