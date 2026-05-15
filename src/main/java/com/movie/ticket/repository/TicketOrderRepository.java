package com.movie.ticket.repository;

import com.movie.ticket.entity.TicketOrder;
import com.movie.ticket.entity.OrderStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface TicketOrderRepository extends JpaRepository<TicketOrder, Long> {
    Optional<TicketOrder> findByOrderNo(String orderNo);

    List<TicketOrder> findTop50ByUpstreamOrderNoIsNotNullAndStatusInOrderByUpdatedAtAsc(Collection<OrderStatus> statuses);
}
