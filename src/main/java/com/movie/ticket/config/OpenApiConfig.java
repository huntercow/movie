package com.movie.ticket.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI ticketOpenApi() {
        return new OpenAPI()
                .components(new Components()
                        .addSecuritySchemes("userSession", new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("opaque session token"))
                        .addSecuritySchemes("adminToken", apiKey("X-Admin-Token"))
                        .addSecuritySchemes("botToken", apiKey("X-Bot-Token"))
                        .addSecuritySchemes("botInstallationId", apiKey("X-Bot-Installation-Id"))
                        .addSecuritySchemes("xianyuPluginToken", apiKey("X-Plugin-Token"))
                        .addSecuritySchemes("xianyuInstallationId", apiKey("X-Plugin-Installation-Id")))
                .info(new Info()
                        .title("Movie Ticket Backend API")
                        .description("多用户电影票控制台、闲鱼插件、微信机器人与良票上游接口")
                        .version("0.3.0"));
    }

    private SecurityScheme apiKey(String headerName) {
        return new SecurityScheme()
                .type(SecurityScheme.Type.APIKEY)
                .in(SecurityScheme.In.HEADER)
                .name(headerName);
    }
}
