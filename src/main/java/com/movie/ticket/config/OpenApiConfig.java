package com.movie.ticket.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI ticketOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Movie Ticket Backend API")
                        .description("电影票报价、订单、票达人上游登录接口")
                        .version("0.1.0"));
    }
}
