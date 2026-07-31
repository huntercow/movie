package com.movie.ticket.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.dto.PiaoDaRenLoginRequest;
import com.movie.ticket.entity.PiaoDaRenAccount;
import com.movie.ticket.repository.PiaoDaRenAccountRepository;
import com.movie.ticket.upstream.PiaoDaRenSession;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.util.unit.DataSize;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class PiaoDaRenAuthServiceTest {

    @Test
    void smokeCheckOnlyCallsSafeReadEndpoints() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        RestClient restClient = builder.build();
        PiaoDaRenSession session = mock(PiaoDaRenSession.class);
        PiaoDaRenAccountRepository accountRepository = mock(PiaoDaRenAccountRepository.class);
        when(session.getUserToken()).thenReturn("token-abc");
        when(accountRepository.findFirstByOrderByLastLoginAtDesc()).thenReturn(Optional.empty());

        server.expect(requestTo("http://h5.liangpiao.net.cn"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("<html><title>良票</title></html>", MediaType.TEXT_HTML));
        server.expect(requestTo("http://business-api.liangpiao.net.cn/film/cinema/getCityList"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("{\"state\":\"200\",\"data\":[]}", MediaType.APPLICATION_JSON));

        PiaoDaRenAuthService service = new PiaoDaRenAuthService(
                restClient,
                properties(),
                session,
                accountRepository,
                new ObjectMapper()
        );

        var response = service.smokeCheck();

        assertThat(response.provider()).isEqualTo("liangpiao-h5");
        assertThat(response.configuredCredentials()).isTrue();
        assertThat(response.loggedIn()).isTrue();
        assertThat(response.checks()).extracting("name")
                .containsExactly("provider", "credentials", "token", "h5-index", "safe-city-list");
        assertThat(response.checks()).allMatch(check -> check.passed());
        assertThat(response.guardedActions()).anyMatch(action -> action.contains("payOrder"));
        assertThat(response.guardedActions()).anyMatch(action -> action.contains("submitOrder"));
        server.verify();
    }

    @Test
    void loginStoresTokenInSessionButNotAccountAuditPayload() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        PiaoDaRenSession session = mock(PiaoDaRenSession.class);
        PiaoDaRenAccountRepository accountRepository = mock(PiaoDaRenAccountRepository.class);
        when(accountRepository.findById("user-1")).thenReturn(Optional.empty());
        server.expect(requestTo("http://business-api.liangpiao.net.cn/login"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("""
                        {"state":200,"token":"secret-token","data":{"id":"user-1","userName":"configured-user","nickname":"seller","token":"nested-secret"}}
                        """, MediaType.APPLICATION_JSON));
        PiaoDaRenAuthService service = new PiaoDaRenAuthService(
                builder.build(),
                properties(),
                session,
                accountRepository,
                new ObjectMapper()
        );

        var response = service.login(new PiaoDaRenLoginRequest("configured-user", "configured-password", "Consume"));

        assertThat(response.loggedIn()).isTrue();
        verify(session).setUserToken("secret-token");
        ArgumentCaptor<PiaoDaRenAccount> accountCaptor = ArgumentCaptor.forClass(PiaoDaRenAccount.class);
        verify(accountRepository).save(accountCaptor.capture());
        assertThat(accountCaptor.getValue().getUserToken()).isNull();
        assertThat(accountCaptor.getValue().getRawResponse()).isNull();
        server.verify();
    }

    private UpstreamProperties properties() {
        return new UpstreamProperties(
                "http://business-api.liangpiao.net.cn",
                "/film/identify/filmIdentify",
                "/film/order/officialQuotation",
                "oss-cn-beijing",
                "liangpiao-ticket-img",
                "",
                "",
                "ticket-img",
                "configured-user",
                "configured-password",
                "Consume",
                "liangpiao-h5",
                "http://h5.liangpiao.net.cn",
                Duration.ofSeconds(5),
                Duration.ofSeconds(20),
                DataSize.ofMegabytes(10),
                false,
                "",
                false
        );
    }
}
