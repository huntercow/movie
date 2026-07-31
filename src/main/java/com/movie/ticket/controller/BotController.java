package com.movie.ticket.controller;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.BotCreateOrderRequest;
import com.movie.ticket.dto.BotImageQuoteRequest;
import com.movie.ticket.dto.BotPaymentConfirmRequest;
import com.movie.ticket.dto.BotPaymentResponse;
import com.movie.ticket.dto.BotQuoteResponse;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.service.BotService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Bot APIs", description = "Private WeChat bot APIs for quote, payment confirmation, order creation, and order polling")
@SecurityRequirement(name = "botToken")
@RestController
@RequestMapping("/api/bot")
public class BotController {

    private final BotService botService;

    public BotController(BotService botService) {
        this.botService = botService;
    }

    @Operation(summary = "Quote ticket image", description = "Called when the bot receives a private chat ticket image. It creates or updates the customer profile and creates a quote.")
    @PostMapping("/messages/image")
    public ApiResponse<BotQuoteResponse> createQuoteFromImage(@Valid @RequestBody BotImageQuoteRequest request) {
        return ApiResponse.ok(botService.createQuoteFromImage(request));
    }

    @Operation(summary = "Confirm payment", description = "Called after manual or bot-side transfer confirmation. The payment record is required before order creation.")
    @PostMapping("/payments/confirm")
    public ApiResponse<BotPaymentResponse> confirmPayment(@Valid @RequestBody BotPaymentConfirmRequest request) {
        return ApiResponse.ok(botService.confirmPayment(request));
    }

    @Operation(summary = "Create order after payment", description = "Validates quote ownership and confirmed payment amount, then creates a local order and starts async upstream submission.")
    @PostMapping("/orders")
    public ApiResponse<OrderResponse> createOrderAfterPayment(@Valid @RequestBody BotCreateOrderRequest request) {
        return ApiResponse.ok(botService.createOrderAfterPayment(request));
    }

    @Operation(summary = "Poll bot order", description = "Bot polls this endpoint for ticketing status. Stop polling when shouldPoll is false.")
    @GetMapping("/orders/{orderNo}")
    public ApiResponse<OrderResponse> getOrder(@PathVariable String orderNo) {
        return ApiResponse.ok(botService.getOrder(orderNo));
    }
}
