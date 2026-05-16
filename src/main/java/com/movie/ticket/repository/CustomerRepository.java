package com.movie.ticket.repository;

import com.movie.ticket.entity.Customer;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface CustomerRepository extends JpaRepository<Customer, Long> {
    Optional<Customer> findByWechatId(String wechatId);

    Optional<Customer> findByCustomerNo(String customerNo);
}
