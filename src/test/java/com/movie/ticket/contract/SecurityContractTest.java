package com.movie.ticket.contract;

import com.movie.ticket.config.SecurityConfig;
import com.movie.ticket.config.AdminApiAuthInterceptor;
import com.movie.ticket.config.BotApiAuthInterceptor;
import com.movie.ticket.config.XianyuPluginAuthInterceptor;
import com.movie.ticket.agent.AgentService;
import com.movie.ticket.identity.IdentityService;
import com.movie.ticket.identity.AppUserRepository;
import com.movie.ticket.identity.SessionAuthenticationService;
import com.movie.ticket.identity.api.AuthController;
import com.movie.ticket.security.DatabaseSessionAuthenticationFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.RestClient;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
        controllers = AuthController.class,
        properties = {
                "ticket.upstream.connect-timeout=1s",
                "ticket.upstream.read-timeout=1s"
        }
)
@AutoConfigureMockMvc(addFilters = true)
@Import({
        SecurityConfig.class,
        DatabaseSessionAuthenticationFilter.class,
        SecurityContractTest.WebTestConfiguration.class
})
class SecurityContractTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SessionAuthenticationService sessionAuthenticationService;

    @MockBean
    private IdentityService identityService;

    @MockBean
    private AppUserRepository userRepository;

    @MockBean
    private AgentService agentService;

    @MockBean
    private XianyuPluginAuthInterceptor xianyuPluginAuthInterceptor;

    @MockBean
    private AdminApiAuthInterceptor adminApiAuthInterceptor;

    @MockBean
    private BotApiAuthInterceptor botApiAuthInterceptor;

    @Test
    void unauthenticatedAppRequestReturnsTheApiEnvelope() throws Exception {
        mockMvc.perform(get("/api/v1/app/account/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("authentication is required"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @Test
    @WithMockUser(roles = "USER")
    void ordinaryUserCannotEnterAdminApi() throws Exception {
        mockMvc.perform(get("/api/v1/admin/users"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("permission denied"))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class WebTestConfiguration {

        @Bean
        RestClient.Builder restClientBuilder() {
            return RestClient.builder();
        }
    }
}
