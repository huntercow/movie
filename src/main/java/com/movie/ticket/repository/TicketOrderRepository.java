package com.movie.ticket.repository;

import com.movie.ticket.entity.TicketOrder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TicketOrderRepository extends JpaRepository<TicketOrder, Long> {
    Optional<TicketOrder> findByOrderNo(String orderNo);
}
