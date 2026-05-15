package com.movie.ticket.upstream;

import com.movie.ticket.dto.MovieTicketInfo;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
@ConditionalOnProperty(prefix = "ticket.upstream", name = "mock-enabled", havingValue = "true", matchIfMissing = true)
public class MockTicketUpstreamClient implements TicketUpstreamClient {

    @Override
    public UploadedImage uploadImage(String imageBase64) {
        return new UploadedImage("https://mock.piaodaren.local/images/" + UUID.randomUUID(), UUID.randomUUID().toString());
    }

    @Override
    public MovieTicketInfo recognizeTicket(String imageUrl) {
        return new MovieTicketInfo(
                "mock-task-id",
                "四川省",
                "成都市",
                "郫都区",
                "510100",
                "mock-cinema-id",
                "mock-cinema-code",
                "测试地址",
                "mock-film-id",
                "https://mock.piaodaren.local/film.jpg",
                1,
                "mock-show-id",
                "测试电影",
                "测试影城",
                LocalDateTime.now().plusDays(1).withSecond(0).withNano(0),
                "1号厅",
                "国语 2D",
                2,
                List.of("5排6座", "5排7座"),
                Map.of("5排6座", "66.00", "5排7座", "66.00"),
                "66.00",
                "132.00",
                imageUrl
        );
    }

    @Override
    public UpstreamQuote quote(MovieTicketInfo ticketInfo) {
        return new UpstreamQuote(new BigDecimal("66.00"), "mock-official-quotation-id", "LIMIT_PRICE", "{\"mock\":true}");
    }

    @Override
    public UpstreamSubmitOrderResult submitOrder(SubmitOrderCommand command) {
        return new UpstreamSubmitOrderResult("MOCK" + UUID.randomUUID(), command.toString(), "{\"mock\":true}");
    }
}
