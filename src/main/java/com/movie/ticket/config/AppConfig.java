package com.movie.ticket.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

@Configuration
@EnableConfigurationProperties({
        UpstreamProperties.class,
        PricingProperties.class,
        XianyuProperties.class,
        AdminApiProperties.class,
        CredentialEncryptionProperties.class
})
public class AppConfig implements WebMvcConfigurer {

    private final XianyuPluginAuthInterceptor xianyuPluginAuthInterceptor;
    private final AdminApiAuthInterceptor adminApiAuthInterceptor;
    private final BotApiAuthInterceptor botApiAuthInterceptor;

    public AppConfig(
            XianyuPluginAuthInterceptor xianyuPluginAuthInterceptor,
            AdminApiAuthInterceptor adminApiAuthInterceptor,
            BotApiAuthInterceptor botApiAuthInterceptor
    ) {
        this.xianyuPluginAuthInterceptor = xianyuPluginAuthInterceptor;
        this.adminApiAuthInterceptor = adminApiAuthInterceptor;
        this.botApiAuthInterceptor = botApiAuthInterceptor;
    }

    @Bean
    RestClient restClient(RestClient.Builder builder, UpstreamProperties properties) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(requirePositiveDuration(properties.connectTimeout(), "upstream connect timeout"));
        requestFactory.setReadTimeout(requirePositiveDuration(properties.readTimeout(), "upstream read timeout"));
        return builder.requestFactory(requestFactory).build();
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(xianyuPluginAuthInterceptor)
                .addPathPatterns("/api/xianyu/**");
        registry.addInterceptor(adminApiAuthInterceptor)
                .addPathPatterns("/api/quotes", "/api/quotes/**", "/api/orders", "/api/orders/**", "/api/upstream/**");
        registry.addInterceptor(botApiAuthInterceptor)
                .addPathPatterns("/api/bot/**");
    }

    private Duration requirePositiveDuration(Duration value, String name) {
        if (value == null || value.isNegative() || value.isZero()) {
            throw new IllegalStateException(name + " must be configured with a positive duration");
        }
        return value;
    }
}
