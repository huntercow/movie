package com.movie.ticket.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.agent.AgentAccess;
import com.movie.ticket.agent.AgentService;
import com.movie.ticket.agent.AgentType;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ApiAuthInterceptorTest {

    @Test
    void xianyuAuthRejectsRequestWithoutActivatedUserToken() throws Exception {
        var interceptor = new XianyuPluginAuthInterceptor(
                new ObjectMapper(),
                mock(AgentService.class)
        );
        var response = new MockHttpServletResponse();

        boolean allowed = interceptor.preHandle(new MockHttpServletRequest(), response, new Object());

        assertThat(allowed).isFalse();
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("unactivated");
    }

    @Test
    void xianyuAuthUsesUserTokenAndBoundInstallation() throws Exception {
        AgentService agents = mock(AgentService.class);
        when(agents.authenticateRuntime("plugin-token", AgentType.XIANYU_PLUGIN, "installation-a"))
                .thenReturn(new AgentAccess(8L, 9L, 10L, AgentType.XIANYU_PLUGIN));
        var interceptor = new XianyuPluginAuthInterceptor(new ObjectMapper(), agents);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Plugin-Token", "plugin-token");
        request.addHeader("X-Plugin-Installation-Id", "installation-a");

        boolean allowed = interceptor.preHandle(request, new MockHttpServletResponse(), new Object());

        assertThat(allowed).isTrue();
        assertThat(request.getAttribute(com.movie.ticket.agent.AgentRequestAttributes.USER_ID)).isEqualTo(8L);
    }

    @Test
    void adminAuthRequiresConfiguredHeader() throws Exception {
        var interceptor = new AdminApiAuthInterceptor(new AdminApiProperties("admin-token"), new ObjectMapper());
        var deniedResponse = new MockHttpServletResponse();

        boolean denied = interceptor.preHandle(new MockHttpServletRequest(), deniedResponse, new Object());

        MockHttpServletRequest allowedRequest = new MockHttpServletRequest();
        allowedRequest.addHeader("X-Admin-Token", "admin-token");
        boolean allowed = interceptor.preHandle(allowedRequest, new MockHttpServletResponse(), new Object());

        assertThat(denied).isFalse();
        assertThat(deniedResponse.getStatus()).isEqualTo(401);
        assertThat(allowed).isTrue();
    }

    @Test
    void botAuthUsesActivatedUserTokenAndInstallation() throws Exception {
        AgentService agents = mock(AgentService.class);
        when(agents.authenticateRuntime("bot-token", AgentType.WECHAT_BOT, "installation-a"))
                .thenReturn(new AgentAccess(8L, 9L, 10L, AgentType.WECHAT_BOT));
        var interceptor = new BotApiAuthInterceptor(
                new ObjectMapper(),
                agents
        );
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Bot-Token", "bot-token");
        request.addHeader("X-Bot-Installation-Id", "installation-a");

        boolean allowed = interceptor.preHandle(request, new MockHttpServletResponse(), new Object());

        assertThat(allowed).isTrue();
    }
}
