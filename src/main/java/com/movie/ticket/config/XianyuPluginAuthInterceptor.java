package com.movie.ticket.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.agent.AgentAccess;
import com.movie.ticket.agent.AgentRequestAttributes;
import com.movie.ticket.agent.AgentService;
import com.movie.ticket.agent.AgentType;
import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.exception.BusinessException;
import com.movie.ticket.security.UserScopeContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class XianyuPluginAuthInterceptor implements HandlerInterceptor {

    private final ObjectMapper objectMapper;
    private final AgentService agentService;

    public XianyuPluginAuthInterceptor(
            ObjectMapper objectMapper,
            AgentService agentService
    ) {
        this.objectMapper = objectMapper;
        this.agentService = agentService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String actualToken = request.getHeader("X-Plugin-Token");
        String installationId = request.getHeader("X-Plugin-Installation-Id");
        if (StringUtils.hasText(actualToken) && StringUtils.hasText(installationId)) {
            try {
                AgentAccess access = agentService.authenticateRuntime(
                        actualToken,
                        AgentType.XIANYU_PLUGIN,
                        installationId
                );
                request.setAttribute(AgentRequestAttributes.USER_ID, access.userId());
                request.setAttribute(AgentRequestAttributes.INSTANCE_ID, access.instanceId());
                UserScopeContext.set(access.userId());
                return true;
            } catch (BusinessException exception) {
                writeError(response, HttpServletResponse.SC_UNAUTHORIZED, exception.getMessage());
                return false;
            }
        }
        writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "invalid or unactivated xianyu plugin token");
        return false;
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception exception
    ) {
        UserScopeContext.clear();
    }

    private void writeError(HttpServletResponse response, int status, String message) throws Exception {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.fail(message)));
    }
}
