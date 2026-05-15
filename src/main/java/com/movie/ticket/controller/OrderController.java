package com.movie.ticket.controller;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.service.OrderSubmitService;
import com.movie.ticket.service.OrderService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;
    private final OrderSubmitService orderSubmitService;

    public OrderController(OrderService orderService, OrderSubmitService orderSubmitService) {
        this.orderService = orderService;
        this.orderSubmitService = orderSubmitService;
    }

    @PostMapping
    public ApiResponse<OrderResponse> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        return ApiResponse.ok(orderService.createOrder(request));
    }

    @GetMapping("/{orderNo}")
    public ApiResponse<OrderResponse> getOrder(@PathVariable String orderNo) {
        return ApiResponse.ok(orderService.getOrder(orderNo));
    }

    @PostMapping("/{orderNo}/submit/retry")
    public ApiResponse<Void> retrySubmit(@PathVariable String orderNo) {
        orderSubmitService.submitAsync(orderNo);
        return ApiResponse.ok(null);
    }
}
