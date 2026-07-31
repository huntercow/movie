package com.movie.ticket.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.dto.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class AdminApiAuthInterceptor implements HandlerInterceptor {

    private final AdminApiProperties properties;
    private final ObjectMapper objectMapper;

    public AdminApiAuthInterceptor(AdminApiProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String expectedToken = properties.apiToken();
        if (!StringUtils.hasText(expectedToken)) {
            writeError(response, HttpServletResponse.SC_SERVICE_UNAVAILABLE, "admin API token is not configured");
            return false;
        }
        if (expectedToken.equals(request.getHeader("X-Admin-Token"))) {
            return true;
        }
        writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "invalid admin API token");
        return false;
    }

    private void writeError(HttpServletResponse response, int status, String message) throws Exception {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.fail(message)));
    }
}
