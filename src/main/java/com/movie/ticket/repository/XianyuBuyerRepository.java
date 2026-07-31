package com.movie.ticket.repository;

import com.movie.ticket.entity.XianyuBuyer;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface XianyuBuyerRepository extends JpaRepository<XianyuBuyer, Long> {
    Optional<XianyuBuyer> findByBuyerUserId(String buyerUserId);

    Optional<XianyuBuyer> findByUserIdAndBuyerUserId(Long userId, String buyerUserId);
}
