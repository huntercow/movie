package com.movie.ticket.config;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class ConsoleEntryController {

    @GetMapping({"/console", "/console/"})
    public String console() {
        return "forward:/console/index.html";
    }
}
