package com.movie.ticket.controller;

import com.movie.ticket.dto.ApiResponse;
import com.movie.ticket.dto.CreateOrderRequest;
import com.movie.ticket.dto.OrderResponse;
import com.movie.ticket.service.OrderSubmitService;
import com.movie.ticket.service.OrderService;
import com.movie.ticket.service.OrderSyncService;
import jakarta.validation.Valid;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
@SecurityRequirement(name = "adminToken")
public class OrderController {

    private final OrderService orderService;
    private final OrderSubmitService orderSubmitService;
    private final OrderSyncService orderSyncService;

    public OrderController(OrderService orderService, OrderSubmitService orderSubmitService, OrderSyncService orderSyncService) {
        this.orderService = orderService;
        this.orderSubmitService = orderSubmitService;
        this.orderSyncService = orderSyncService;
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
    public ApiResponse<OrderResponse> retrySubmit(@PathVariable String orderNo) {
        orderSubmitService.resumeSubmitAndPay(orderNo);
        return ApiResponse.ok(orderService.getOrder(orderNo));
    }

    @PostMapping("/{orderNo}/submit/repeat")
    public ApiResponse<OrderResponse> repeatSubmit(
            @PathVariable String orderNo,
            @RequestParam(defaultValue = "false") boolean force
    ) {
        orderSubmitService.repeatSubmitAndPay(orderNo, force);
        return ApiResponse.ok(orderService.getOrder(orderNo));
    }

    @PostMapping("/{orderNo}/sync")
    public ApiResponse<OrderResponse> sync(@PathVariable String orderNo) {
        orderSyncService.syncOrder(orderNo);
        return ApiResponse.ok(orderService.getOrder(orderNo));
    }
}
