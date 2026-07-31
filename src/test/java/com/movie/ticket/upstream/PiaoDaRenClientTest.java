package com.movie.ticket.upstream;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.movie.ticket.config.UpstreamProperties;
import com.movie.ticket.dto.MovieTicketInfo;
import com.movie.ticket.exception.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.util.unit.DataSize;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class PiaoDaRenClientTest {

    private MockRestServiceServer server;
    private PiaoDaRenSession session;
    private PiaoDaRenClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        session = mock(PiaoDaRenSession.class);
        when(session.getUserToken()).thenReturn("token-abc");
        client = new PiaoDaRenClient(builder.build(), properties(DataSize.ofMegabytes(10)), session, new ObjectMapper());
    }

    @Test
    void parsesOcrAndChoosesHigherOfficialQuote() {
        server.expect(requestTo("http://business-api.liangpiao.test/film/identify/filmIdentify"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("user-token", "token-abc"))
                .andExpect(content().string("imgUrl=https%3A%2F%2Fimage.test%2Fticket.jpg"))
                .andRespond(withSuccess("""
                        {"state":200,"result":true,"data":{"taskId":"ocr-1","imageUrl":"https://image.test/ticket.jpg","discern":{
                          "province":"四川省","city":"成都市","cityCode":"510100","showId":"show-1",
                          "filmName":"测试电影","cinemaName":"测试影院","showTime":1780000000000,
                          "seats":[{"seatName":"5排6座","seatPrice":3300},{"seatName":"5排7座","seatPrice":3200}],
                          "totalImagePrice":6500
                        }}}
                        """, MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://business-api.liangpiao.test/film/order/officialQuotation"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json("""
                        {"showId":"show-1","netPrice":"3300","seatCount":2,"seatName":["5排6座","5排7座"],"quotationChannels":["LIMIT_PRICE"]}
                        """))
                .andRespond(withSuccess("{" + "\"state\":200,\"result\":true,\"data\":{\"limitPrice\":2766,\"taskId\":\"limit-task\"}}", MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://business-api.liangpiao.test/film/order/officialQuotation"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().json("""
                        {"showId":"show-1","netPrice":"3300","seatCount":2,"seatName":["5排6座","5排7座"],"quotationChannels":["FIX_PRICE"]}
                        """))
                .andRespond(withSuccess("{" + "\"state\":200,\"result\":true,\"data\":{\"fixPrice\":2888,\"taskId\":\"fix-task\"}}", MediaType.APPLICATION_JSON));

        MovieTicketInfo ticket = client.recognizeTicket("https://image.test/ticket.jpg");
        UpstreamQuote quote = client.quote(ticket);

        assertThat(ticket.showId()).isEqualTo("show-1");
        assertThat(ticket.seats()).containsExactly("5排6座", "5排7座");
        assertThat(ticket.maxPrice()).isEqualTo("33.00");
        assertThat(quote.price()).isEqualByComparingTo("28.88");
        assertThat(quote.taskId()).isEqualTo("fix-task");
        assertThat(quote.selectedChannel()).isEqualTo("FIX_PRICE");
        server.verify();
    }

    @Test
    void unauthorizedResponseClearsSession() {
        server.expect(requestTo("http://business-api.liangpiao.test/film/identify/filmIdentify"))
                .andRespond(withStatus(HttpStatus.UNAUTHORIZED));

        assertThatThrownBy(() -> client.recognizeTicket("https://image.test/ticket.jpg"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("authentication expired");
        verify(session).clear();
    }

    @Test
    void rejectsInvalidImageBeforeOssUpload() {
        assertThatThrownBy(() -> client.uploadImage("data:text/plain;base64,QQ=="))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("unsupported ticket image type");
        assertThatThrownBy(() -> client.uploadImage("not-base64"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("not valid base64");

        PiaoDaRenClient sizeLimitedClient = new PiaoDaRenClient(
                RestClient.create(),
                properties(DataSize.ofBytes(1)),
                session,
                new ObjectMapper()
        );
        assertThatThrownBy(() -> sizeLimitedClient.uploadImage("data:image/png;base64,QUI="))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("exceeds maximum size");
    }

    private UpstreamProperties properties(DataSize maxImageSize) {
        return new UpstreamProperties(
                "http://business-api.liangpiao.test",
                "/film/identify/filmIdentify",
                "/film/order/officialQuotation",
                "oss-cn-beijing",
                "bucket",
                "access-key",
                "access-secret",
                "ticket-img",
                "configured-user",
                "configured-password",
                "Consume",
                "liangpiao-h5",
                "http://h5.liangpiao.test",
                Duration.ofSeconds(5),
                Duration.ofSeconds(20),
                maxImageSize,
                false,
                "",
                false
        );
    }
}
